# SDK 0.2.0-devnet.12 ストリーミング更新

2026-10-11 JST。[公式release](https://github.com/yukikm/solana-zkapi/releases/tag/v0.2.0-devnet.12)のsource commitは `989bdd3abe796c65c0d954ce761436d212b08840`、SDK archive SHA-256は `cf6deabf4e929deff9e9c5239144fc5ac6e64e6db7612af6c28a6bebd62bd129` です。

## 修正内容

旧SDKでは、正常な終端SSEを受け取った後、HTTP EOFの前にbodyをキャンセルすると応答が中断扱いになり、次の送信前に手動の支払い確認が必要になる場合がありました。[上流の更新手順](https://github.com/yukikm/solana-zkapi/blob/v0.2.0-devnet.12/docs/getting-started/sdk-streaming-upgrade.md)に従い、署名検証済みの `.12` SDKを導入し、本体とprover Workerを再ビルドしました。

`.12` は正常な終端SSEとHTTP EOFを確認します。アプリは従来どおり `readChatDeltas(response)` を最後まで読み、会話の `sessionId`、送信操作ごとの新しいUUID、`keyReuseSeconds: 60`、StopのAbortSignalを維持します。正常終了後は有効な同じsessionを再利用し、期限切れ時はSDKの上限45秒の精算待ちを使います。中断・不確定状態・精算タイムアウトでは元の操作を保持し、既存の明示的な復旧へ進みます。推論や取引を自動再送せず、送信可否はSDKの `canRequest` に従います。

SDKはnative clone/teeにも対応しますが、zkchatは引き続き単一のreaderを使います。応答表示の完了と精算状態は別に扱います。

## 配布物と互換性

- Node `24.19.0` / npm `11.9.0` を使用。GitHub `release verify`、SDKと `SHA256SUMS` の `verify-asset`、認証済み一覧とのSHA-256照合に成功しました。
- `vendor/zkapi-solana-sdk-0.2.0-devnet.12.tgz` とlockfileを更新し、以前の `.10`・`.8`・`.3` archiveを保持。`verify:sdk` は4世代を検査します。Solana Kitは `8.4.0` のままです。
- `public/zkapi-config.json` と旧版configは元のbytesを維持。revision-6 profileのhashは `ec10c1ab41bb5105222d3e25c7e1eba6b96b1b397abd0f854657030269992a77` のままです。
- storageは `zkchat-sdk-0.2.0-devnet.8`、最初のnote IDは `zkchat-note-sdk-0.2.0-devnet.8` のままです。暗号化journal・Deposit catalog・復旧資料を移行・消去しません。
- `/recovery-v3/` は元の `.3` SDK・Worker・profileを維持します。公開originも `https://dzt0611ozdx70.cloudfront.net` のままです。
- ライセンス本文を保持し、SDKの版とhashを更新。既存のWallet Standard noticeの版表記も、導入済み `1.1.1` に合わせて修正しました。依存更新はSDKだけです。
- 今回の開始時点ですでに公開されていたreadinessの503再確認待ちと出金途中の案内修正も保持します。

## 検証と公開

- [ローカル検証記録](evidence/verification-sdk12-20261011.json): 単体196件、オフラインChromium 48件が成功。TypeScript、本体・復旧版ビルド、`check-build`、`check:aws`、4世代のarchive検査が成功しました。
- SDKの実配布parserで終端SSE後のEOF待機、中断、早期EOF、不正な末尾データ、clone、読み取りタイムアウトを確認。アプリ画面では正常終了後の次の明示送信、同じsession IDと別のoperation UUID、Stopの伝播と非再送を確認しました。
- 実際の旧 `.8` 暗号化journal実装で作成した複数Deposit・選択状態・合成の未完了レコードを `.12` で再読込し、既存の暗号文が維持されることを確認しました。
- [公開API事前確認](evidence/public-preflight-20261011-sdk12.json): 18:07 JST、元のprofileでSDK preflight全10項目・readinessに成功。21モデルと受付・復旧の有効状態を確認しました。
- [CORS確認](evidence/cors-sdk12-20261011.json): 既存の公開originで11ルートのOPTIONSが成功しました。

通常のテストはfixtureを使います。利用者の実ブラウザ保存領域、ウォレット署名、AUTH、実推論、精算・入出金は操作していません。公開APIの確認は観測時点の結果であり、有資金での実推論確認は含みません。

[実SDKブラウザ確認](evidence/browser-sdk12-20261011.json)では隔離Chromiumから公開profile・SDK・Worker・WASM・IndexedDBを使い、署名できないテスト用アカウントで保存領域の初期化と再接続に成功しました。公開preflightは初回も画面に利用可能と表示されましたが、config取得で `net::ERR_ABORTED` を1件記録したためテストは再試行され、2回目は通信失敗なしで成功しました。

## 公開反映

18:10 JST、既存の `zkchat-static` / CloudFront `E3OT9UOJBXFFK5` に272ファイル（13,037,521 bytes）を反映しました。実行時に既存アカウントとSubscriptionの `ACTIVE` / `FREE` を照合しています。invalidation `IAY46G6SUE0BCA1ET74T69EG93` は完了しました。

[18:11 JSTの公開反映検証](evidence/deployment-sdk12-20261011.json)で、本体・復旧版のHTML、設定、JS/CSS、Worker、noticeの18ファイルがビルドとSHA-256・MIME・cacheまで一致しました。HTTPS・復旧ルート・欠落ファイルの6項目と、旧asset 10ファイルの保持を確認しました。隔離ブラウザではデモ返信、SDK `.12` 表示、`.3` 復旧画面への同一origin遷移と保存sentinelの保持に成功し、JavaScriptエラーはありません。

再検証は `node scripts/check-deployed.mjs --origin https://dzt0611ozdx70.cloudfront.net --sdk 0.2.0-devnet.12 --output docs/evidence/deployment-recheck.json` で実行できます。旧assetも検査する場合は `--baseline` に以前の同形式の検証JSONを渡します。
