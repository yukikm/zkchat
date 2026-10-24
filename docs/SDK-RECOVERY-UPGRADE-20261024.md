# SDK .15 支払い復旧の更新

2026-10-24 JST。通常画面のSDKを `0.2.0-devnet.13` から `0.2.0-devnet.15` に更新しました。現在のPool・profile・保存領域を維持する更新です。05:13〜05:14 JSTに[同じ公開URL](https://dzt0611ozdx70.cloudfront.net)へ反映し、配信と公開ブラウザの検証が完了しました。

## 配布物の検証

[公式release](https://github.com/yukikm/solana-zkapi/releases/tag/v0.2.0-devnet.15)と[更新ガイド](https://github.com/yukikm/solana-zkapi/blob/94e4969f3169bfc790fc6f4186fc2bf94dbe074a/docs/getting-started/direct-recovery-upgrade.md)に従いました。

| 項目           | 値                                                                 |
| -------------- | ------------------------------------------------------------------ |
| SDK            | `0.2.0-devnet.15`                                                  |
| Release source | `94e4969f3169bfc790fc6f4186fc2bf94dbe074a`                         |
| Archive        | `vendor/zkapi-solana-sdk-0.2.0-devnet.15.tgz`                      |
| SHA-256        | `976fd54b7fdcbafea75870728c018d50d821bdc5e5137e4a8b8e7b3c77f15f98` |
| Bytes          | `161377`                                                           |
| Node / npm     | `24.22.1` / `11.19.1`                                              |
| Solana Kit     | `8.4.0`（維持）                                                    |

`gh release verify`、SDK archive・`release-manifest.json`・`SHA256SUMS`それぞれの `gh release verify-asset` が成功しました。archiveの実測SHA-256とサイズは、認証済みmanifest・SHA256SUMSと一致します。npm公開は行われていないため、公式tarballをvendorへ保存してlockfileに固定しました。依存更新はSDK 1件で、`npm audit`は0件です。旧archiveを保持し、`verify:sdk`に `.15` を追加しました。

## 保存領域と互換性

- `public/zkapi-config.json` のbytesとprofile hash `5e15d66c6f45265951cf1f8dd6cc0dae6574c4b8dd6756f828f7543ecaa97b9a` を維持。
- deploymentは `public-devnet-20261021-state-v1`、保存名は `zkchat-sdk-public-devnet-20261021-state-v1`、初回note IDは `zkchat-note-sdk-public-devnet-20261021-state-v1` のまま。
- `.13` で作成した暗号化journalを `.15` で読み込む回帰テストを追加。未解決session、元の認可・復旧token、履歴、選択catalogとciphertextの保持を検証。実残高・証明の検証ではなく、合成データによる保存互換性の確認です。
- 既存のprofile/account bindingを上書きせず再利用することも確認。
- `/recovery-v12/` と `/recovery-v3/` はそれぞれ元のSDK・Worker・config・保存名を保持。現在と旧Poolのデータを付け替えません。

## 支払い確認の表示

SDK `.15` の `recover()` が返す `completed` / `pending` / `failed` と、処理後の `status()` を確認します。旧SDKのvoid戻り値では引き続きstatusで判定します。

`Payment details` は、ローカルの `closing` とサーバーの `ISSUANCE_UNKNOWN` を区別し、キーが見つからない `provider_key_absent` と、照合自体が失敗した `provider_lookup_failed` を説明します。operator調査が必要な場合はその旨と保存データ保持を案内します。許可した理由コードと検証済みHTTP番号だけを表示し、providerの本文・秘密情報をそのまま表示しません。

既存のローカル表示修正（精算待ちと出金の区別、遅延出金が任意である説明）を保持しました。支払い確認はメッセージを再送せず、出金を自動開始しません。送信可否は引き続きSDKの `canRequest` など既存の制御に従います。

## 検証記録

2026-10-24 04:59 JSTに公開SDK preflightの全10項目とreadinessが成功しました。[公開preflight](evidence/public-preflight-20261024-sdk15.json)。同時刻に公開アプリoriginのCORS全11ルートが成功しました。session作成・状態取得・終了の `X-Zkapi-Recovery-Diagnostics` 許可も確認しています。[CORS記録](evidence/public-cors-20261024-sdk15.json)。

ローカルの最終検証結果:

- 単体テスト340件成功（16ファイル）。
- 通常E2Eは81件成功。公開用opt-inの3件は別実行で全件成功。
- 最終調整後の支払い復旧E2E 7件とhelper単体5件も成功。
- 型チェック、SDK archive 6世代のSHA照合、`git diff --check` が成功。
- 通常 `.15` と復旧 `.12` / `.3` の本番ビルドが成功。ブラウザでSDK表示・profile固定・同一origin遷移・保存状態保持を検証。
- `check:aws` のCloudFront配信エミュレーションが成功。公開計画は408ファイル / 20,463,087 bytes。初回確認は `publish:aws` の計画表示のみで、その後の公開実行結果は以下に記録しています。
- 同梱する3世代のSDKライセンス本文を保持し、noticeの版・lockfile・manifest・collectionのhashを照合。

隔離Chromiumでは[公開preflight](evidence/public-browser-preflight-20261024-sdk15.json)、[SDK・Worker・WASM・無資金保存領域の初期化と再接続](evidence/public-browser-custody-20261024-sdk15.json)、[署名前の入金準備](evidence/public-browser-deposit-preparation-20261024-sdk15.json)が成功しました。入金準備でRPC HTTP429を1回観測し、既存の読み取り専用バックオフで回復、約35秒で署名なしの準備が完了しました。新たな自動再試行は追加していません。

これらは読み取り確認です。利用者のブラウザ保存領域、署名、入出金、AUTH、有料推論を実行した結果ではありません。既存の不明な支払いが更新だけで精算完了になるとは扱いません。上流releaseも、過去の不明sessionにはoperatorの追加調査が必要としています。

## 公開反映と検証

利用者の依頼により、既存の `zkchat-static` スタックへ408ファイル / 20,463,087 bytesを配信しました。公開直前の再ビルドは、検証済み408ファイルすべてとSHA-256が一致しました。公開スクリプトはAWSアカウント・スタック・ライブの `ACTIVE` / `FREE` Subscriptionと対象distribution/WAFを検証してから実行しています。

- 公開URL: https://dzt0611ozdx70.cloudfront.net
- CloudFront: `E3OT9UOJBXFFK5`
- キャッシュ更新: `I28MZKLCFGXPBARF35PV6VPUJX`（05:13:31 JST作成、`Completed`を確認）
- 旧assetは削除せず、SDK `.12` / `.3` 復旧画面と同一originを維持。

[配信検証](evidence/deployment-sdk15-20261024.json)で本体・復旧版の主要27ファイルのSHA-256 / MIME / cache、9ルーティング項目、以前の15 assetの保持に成功しました。隔離ブラウザでデモ応答、通常 `.15` / 復旧 `.12` / `.3` 表示、同一origin遷移と保存状態保持を確認し、JavaScriptエラーは0件でした。この検査では外部APIを遮断しています。

別の[公開ブラウザ検査](evidence/deployed-public-browser-20261024-sdk15.json)は設定を差し替えず、実際の配信ページと認証済みprofileを使用しました。05:14:29〜05:14:37 JSTに `.15` 表示と `Service ready` を確認しています。48リクエスト（許可した読み取りRPC 6回を含む）で、禁止操作、JavaScript・HTTP・通信エラーはいずれも0件でした。ウォレット接続・資金の操作・有料推論は行っていません。

公開作業中の[SDK preflight / readiness](evidence/deployed-public-preflight-20261024-sdk15.json)と[CORS全11ルート](evidence/deployed-public-cors-20261024-sdk15.json)も成功しました。既存の未解決sessionが精算済みになったかは、この公開検査の対象外です。

## 診断ヘッダーの配信検査

`OPTIONS` の成功だけでは、実際のGETで `X-Zkapi-Recovery-Diagnostics` が転送されることを確認できません。`npm run check:recovery-diagnostics -- https://dzt0611ozdx70.cloudfront.net [記録先.json]` は、認証済みprofileの公開APIへ存在しないsessionと偽のcredentialを使った読み取りGETだけを送ります。ヘッダーなし／値 `1` の404と、不正値 `2` の400拒否を比較し、中継でヘッダーが落ちる不具合を検出します。

実sessionのtoken・ウォレット・復旧処理・有料推論・トランザクションは使用しません。この検査の成功は、実sessionの診断内容や精算完了を証明するものではありません。従来の `check:cors` は引き続きOPTIONSだけの検査です。
