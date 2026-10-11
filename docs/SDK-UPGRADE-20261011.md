# SDK 0.2.0-devnet.10 更新確認

2026-10-11 JST。対象は[公開release v0.2.0-devnet.10](https://github.com/yukikm/solana-zkapi/releases/tag/v0.2.0-devnet.10)、client source `5a880fa4ddf6241fd29d3c125a4750e25a479a39`。GitHubのrelease/asset attestationとarchive SHA-256を照合し、公開tarballをvendorへ追加しました。

## 既存入金と保存領域

[上流の更新手順](https://github.com/yukikm/solana-zkapi/blob/5a880fa4ddf6241fd29d3c125a4750e25a479a39/docs/releases/authorization-recovery-preview.md)に従い、実行SDKと保存領域の世代を分離しました。既存profileの差し替え、custodyの移行・消去、入金・出金の実行はありません。

| 項目                | 更新後                                                             |
| ------------------- | ------------------------------------------------------------------ |
| 本体とprover Worker | `@zkapi/solana-sdk` `0.2.0-devnet.10`                              |
| archive SHA-256     | `087e5dd6da712710509a5320f93e4426687382a7f976e8ce522e83b2318a08a2` |
| profile             | 元の `.8` revision-6、URL・bytes・hashは変更なし                   |
| profile SHA-256     | `ec10c1ab41bb5105222d3e25c7e1eba6b96b1b397abd0f854657030269992a77` |
| storage             | `zkchat-sdk-0.2.0-devnet.8` を維持                                 |
| 最初のnote ID       | `zkchat-note-sdk-0.2.0-devnet.8` を維持                            |
| 追加Deposit         | 暗号化catalog・選択済みID・各noteを維持                            |
| `.3` 復旧版         | 元のSDK・profile・保存名・note IDを維持                            |
| 公開URL             | `https://dzt0611ozdx70.cloudfront.net` を維持                      |

旧 `.8` archiveも保存し、`verify:sdk`で `.10`・`.8`・`.3` を照合します。Solana Kit `8.4.0`とその他の依存は変更していません。ライセンス一覧はSDKバージョン・manifest hashを更新し、license本文のbytesは維持しました。

## 明示的な認可復旧

既存の`Check payment` → `recover()`が `.10` の復旧機能を利用します。サーバーが未受付と確認した不確定AUTHは、署名付きの取消記録を検証してjournalに保存し、元のDepositと残高を保持して再び送信可能になります。受付済みsessionは通常の精算へ進みます。推論を自動再送せず、次の送信には利用者の操作が必要です。

`Disable authorization for withdrawal`は別の恒久的な操作です。既にこの操作を完了したnoteは `.10` でもチャット用に復活しません。既存の注意表示とタイムアウト・中断対応も維持しました。新しい復旧記録を書き込んだjournalは旧SDKが拒否する場合があるため、更新後は `.10` または互換性のある後継版を使用します。

## 検証範囲

- Node `24.19.0` / npm `11.9.0`。GitHub release/asset attestation、archive SHA-256、TypeScript、単体189件・オフラインChromium 46件が成功（実サービス向け3件は通常E2Eではskip）。
- 実際の `.8` archiveから旧暗号化実装を読み込み、複数Deposit・選択済みcatalog・合成した未完了データを `.10` で再読込。読み取りで保存内容が変わらず、Deposit選択後も資金レコードの暗号文が変わらないことを検証。これは保存形式の検査で、実資金や証明の検証ではありません。
- 本体・復旧版のSDK表示、profile pin、Worker、同一origin遷移・保存状態、CloudFront配信ルールを検証。
- [公開API確認](evidence/public-preflight-20261011-sdk10.json): 15:03–15:04 JST、元のprofileでSDK preflight全10項目・readinessが成功。21モデル、受付・復旧の有効状態を確認。
- [CORS確認](evidence/cors-sdk10-20261011.json): 固定の本番originで認可復旧ルートを含む11ルートのOPTIONSを確認。

利用者の実ブラウザ保存領域は操作していません。実ウォレット署名、新規AUTH、実推論、精算・出金を伴う検証は今回の範囲に含みません。公開APIの確認結果は確認時点の状態です。

## 公開反映

15:07 JST、既存の `zkchat-static` / CloudFront `E3OT9UOJBXFFK5`へ272ファイルをアップロードし、キャッシュ無効化完了を確認しました。元のURL・バケット・Freeプランを維持し、旧assetも保持しています。

[公開反映検証](evidence/deployment-sdk10-20261011.json)で18ファイルのSHA-256・MIME・cache一致と旧asset 3ファイルの保持を確認しました。隔離ブラウザでデモ応答・SDK `.10` 表示・`.3` 復旧版への同一origin遷移・保存sentinelの保持に成功し、実profileを読み込んだ`Check service`も成功しました。
