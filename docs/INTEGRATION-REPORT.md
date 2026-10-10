# Solana zkAPI 第三者チャットアプリ統合レポート

**最新（2026-10-10）:** [SDK .8への更新・既存 .3の復旧経路・公開catalogの障害](SDK-UPGRADE-20261010.md)を別途記録しています。以下はSDK .3を使った2026-10-09時点の結果であり、現在の公開API可用性を示すものではありません。

検証日: **2026-10-09 JST**。参照ソース: [`67b05cf30fbd009facb87a3451ae65b1971e86b5`](https://github.com/yukikm/solana-zkapi/tree/67b05cf30fbd009facb87a3451ae65b1971e86b5)。公開APIソースは `.5` のCORS開放を含み、配布SDKは引き続き **0.2.0-devnet.3** です。

## 更新後の結果

**前回のCORS障害は解消しています。** Nodeとブラウザの公開preflight 10項目が成功し、localhostからquote・AUTH・session・close・receipts・withdrawalを含む10ルートのOPTIONSも成功しました。任意のHTTPS/localhost originは登録不要、`credentials: "omit"`が現行契約です。以前のorigin承認案内はアプリ・READMEから除去しました。

実ChromeではSolflareのWallet Standard接続、Kit connector接続、公開SDKの初期化、ZK証明準備、**2 Devnet USDCの入金、実AI応答・精算、2 USDCの出金確定**まで確認しました。PhantomはKitもZKAPIも使わない`standard:connect`単体で内部エラー`-32603`が再現しました。これは現在のCORS障害やZKAPI不具合に分類していません。

**Solana ZKAPI本体、operator設定、SDK配布archiveには変更を加えていません。** 公開ソースの参照コピーだけを`/tmp`へ取得し、このチャットアプリだけを変更しています。

## 公開入力と互換性

| 項目            | 値                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| SDK             | `@zkapi/solana-sdk` `0.2.0-devnet.3`（公開archive、改変なし）                                            |
| SDK SHA-256     | `5dfa1d9edf58e6a8b3359cc16d29e55657b6c205e948b7ca1b7b40018e452887`                                       |
| profile         | `https://d366buuvadnp3.cloudfront.net/releases/public-devnet-20261008-a/profile-sdk-0.2.0-devnet.3.json` |
| profile SHA-256 | `449657cc3fe90f12878236b83d68ada8077e3c56e67ccb8268c5f301e69e02e5`                                       |
| manifest hash   | `b97e200769be24448a51999346a28d0ca497892d68212f517b2b9bb4cc1a4643`                                       |
| Pool            | `Cx8DbA49UCuASoc3goLCU9ro25eWVtcGMbvfPPJsSQzV`                                                           |
| model / mode    | `openai/gpt-4o-mini` / `direct_openrouter`                                                               |
| cap / output    | 1 USDC / 最大128 tokens                                                                                  |
| Solana / wallet | `@solana/kit` 8.4.0 / `@solana/kit-plugin-wallet` 0.21.0 / Wallet Standard                               |
| 検証runtime     | Node 24.19.0 / npm 11.9.0                                                                                |

[Solana公式frontend案内](https://solana.com/docs/frontend)に沿ってKitとWallet Standardを採用。npm registryでもwallet pluginの現行版は0.21.0でした。`web3.js`、旧wallet-adapter、operatorの管理キーは使用していません。

## 証跡

- [Nodeの公開preflight](evidence/public-preflight-20261009-recheck.json): **13:45 JST**、10項目成功。受付/復旧enabled、招待不要、control/indexer/signer available。
- [隔離Chromiumの公開preflight](evidence/browser-preflight-20261009-recheck.json)・[画面](evidence/browser-preflight-20261009-recheck.png): 実公開サービスを使用。RPC、snapshot、readiness成功。実Chromeでもlocalhostで10項目成功を確認。
- [localhostの10ルートCORS](evidence/cors-routes-localhost-20261009.json): **13:49 JST**、全ルート204、`Access-Control-Allow-Origin: *`、必要method/header一致。OPTIONS成功は有資金リクエストの成功を証明しない。
- [Phantom/Solflare比較](evidence/wallet-standard-comparison-20261009.json): 接続のみ。Solflareは両方式で成功。Phantomは直接Wallet Standardでも失敗。
- [実Solflare入金](evidence/solflare-deposit-20261009.json): **13:56 JST確認**、2,000,000 micro-USDCの移動、finalized slot `509064887`、`err: null`、fee 5,000 lamports。取引は[`42dAG…RiSV9`](https://explorer.solana.com/tx/42dAGQH9KZ2wwN9p8Ho5wRJJCXhq9DEXMECUVoAuwbK6mgzQMY6PL4H1kCHS3ThivprJGpihWNh2xyRd8gqRiSV9?cluster=devnet)。SDKも`complete` / 送信可能になった。
- [実AI応答と精算](evidence/live-chat-settlement-20261009.json)・[出金後の会話画面](evidence/live-chat-complete-20261009.jpg): 1回だけ推論を送信。日本語応答後の未精算状態をSDK recoveryで精算し、表示は0 micro-USDC。provider最終請求との一致は未検証（後述）。
- [実Solflare出金](evidence/solflare-withdrawal-20261009.json): **14:06 JST確認**、`ExecutePayload`、finalized slot `509067610`、`err: null`、この最終取引のfeeは5,000 lamports。vaultは2→0 USDC、接続ウォレットは54.01→56.01 USDCとなり、2 USDCの返却を確認。取引は[`5qjeN…s2A4AR`](https://explorer.solana.com/tx/5qjeNHKAMGdFHSGTiE4WHLkK29uBGu67f3cvMRZpMmgCeCj1aHapFnF73HgmUWGWeyhVmhTLF9zBYLMBQis2A4AR?cluster=devnet)。続けてSDKの`complete`とwithdrawn表示も確認。最終取引の手数料は出金全体の手数料・rentとは別。[再接続した保存noteの表示](evidence/withdrawal-reopened-20261009.json)・[完了画面](evidence/withdrawal-complete-20261009.jpg)でもwithdrawnと0 USDCを確認。

## 今回のアプリ修正

- CORS開放後の案内へ更新。RPC例外だけでCORSが原因だと決めつけず、snapshot検証失敗を別の診断として表示。
- 公開接続チェックに確認時刻を表示。受付情報は継続稼働保証にしない。新しい入金/送信前の再検証を維持。
- quote/AUTH/session/close/receipts/withdrawal/readiness/treeを調べるCORSコマンド。認証済みprofileからendpointを導出し、メソッドだけでなく必須headerも照合。金融ルートに送るのはOPTIONSだけ。
- 未送信AUTHの取消、期限切れsetup照合、未署名mutual withdrawalからescapeへの切替を明示ボタンで提供。実行条件の最終検証は公開SDKに任せ、推論再送や未確定取引の置換はしない。
- 入金/送信前の公開受付失敗をチャットにも表示。サーバーの生レスポンス・キー・URL付き内部例外は表示しない。
- 出金前に複数署名・各取引の手数料・最後の取引だけがUSDCを返すことを明記。署名前と送信済みでボタン文言を分け、通常のpending中に期限切れsetupやescapeへの切替を表示しない。
- 入金準備中・出金済みnoteの古いSDK残高をfunded creditsとして表示しない。出金済みは0 USDCと完了案内を表示する。
- Viteの初回Worker依存最適化によるページ再読み込みを観測したため、`@zkapi/solana-sdk/prover-worker`を事前最適化。公開SDKのバグとは区別する。
- エラーにUSDCという文字が含まれるだけで生メッセージを表示していた条件を除去。ローカル金額入力エラーは専用型で表示する。
- 開発専用`wallet-check.html`で、SDK/Kitを使わずWallet Standardの接続だけを確認可能。標準ビルドの`dist`には含めない。

## ZKAPI側の残課題（本セッションでは未修正）

### ZKAPI-01: CORS / 第三者origin登録 — 解消

以前のHTTP400とHTTPS許可リストの問題は、[上流のCORS開放記録](https://github.com/yukikm/solana-zkapi/blob/67b05cf30fbd009facb87a3451ae65b1971e86b5/docs/evidence/PD-public-cors-20261009.md)および今回の実ブラウザ/OPTIONS検証により解消を確認しました。旧記録は[変更前のレポート](INTEGRATION-REPORT-20261009-before-cors.md)へ保存しました。

### ZKAPI-02: consumerドキュメントのバージョン・招待説明 — 残存

[quickstart](https://github.com/yukikm/solana-zkapi/blob/67b05cf30fbd009facb87a3451ae65b1971e86b5/docs/sdk/quickstart.md)のインストール例と[public-profile guide](https://github.com/yukikm/solana-zkapi/blob/67b05cf30fbd009facb87a3451ae65b1971e86b5/docs/sdk/public-profile.md)は`.2`中心です。[funding guide](https://github.com/yukikm/solana-zkapi/blob/67b05cf30fbd009facb87a3451ae65b1971e86b5/docs/sdk/devnet-funding.md)にはinvitation-onlyと招待取得の指示が残り、現行公開ガイド/実APIの`.3`・招待不要と整合していません。

consumerの開始点で現行入力を一貫して示し、古いcampaignの条件を日付付き履歴へ分離する必要があります。本アプリは現行の[公開Devnetガイド](https://github.com/yukikm/solana-zkapi/blob/67b05cf30fbd009facb87a3451ae65b1971e86b5/docs/sdk/public-devnet-preview.md)と認証済みprofileを採用しました。

### ZKAPI-03: provider容量・最終請求の検証範囲

`admission: enabled`とreadinessはprovider残高/追加AUTH/最終provider請求の成功を保証しません。上流にも有限のprovider予算と遅延計量の制約が明記されています。profileに出力token上限のフィールドがないため、この公開previewではドキュメントの128 tokensをアプリ側で強制しています。複数deployment向けの機械可読な上限・予算範囲の説明は残課題です。

### ZKAPI-04: snapshotの間欠的な可用性 — 上流で既知

[上流CORS検証](https://github.com/yukikm/solana-zkapi/blob/67b05cf30fbd009facb87a3451ae65b1971e86b5/docs/evidence/PD-public-cors-20261009.md)はtree-root HTTP503をCORSと別の問題として記録しています。今回の公開preflight成功だけで継続可用性を保証しません。snapshot例外は追加入金で解決するものではなく、保存済みnoteを保持して接続チェックを明示的に再実行します。

## ウォレット環境の残課題

Phantomは接続承認後に`-32603`。公式定義は[Internal Error](https://docs.phantom.com/solana/errors)です。拡張機能のport切断や他拡張とのEVM provider競合のログも観測しましたが、Solana接続の根本原因としては未特定です。再インストール、秘密鍵取得、拡張の無効化、サイトデータ消去は行っていません。

同一localhost originでSolflareの接続・SDK初期化・署名・入金・出金は成功しています。Phantom既存データをSolflareへ移行した扱いにはせず、Solflareアカウントの保存領域を明示的に作成しました。

## 保存と復旧

元のprofile digest、`zkchat-sdk-0.2.0-devnet.3`、`zkchat-note-sdk-0.2.0-devnet.3`を維持。保存領域はorigin・browser profile・wallet account・deploymentと結び付きます。`localhost`と`127.0.0.1`は別originです。今回の実検証の保存領域は`http://localhost:5173`側です。検証noteは出金済みですが、履歴の再接続にも元のoriginを使います。SDKの暗号化journalと画面の会話履歴は別物で、会話削除は資金やjournalを削除しません。

画面を閉じたりコード変更で再読み込みが起きても、元のorigin・アカウントで`Verify connection`し、保存された操作から続けます。古い`zkchat-v1`を新しいprofileに結び直すことはありません。ポータブルbackupは引き続き未提供です。2026-10-09の追加修正で、出金後・残高不足時の新しいDepositと保存済みDepositの切替を実装しました（下記参照）。

## 実AI応答と精算

Solflareの同じnoteから「接続テストです。ゼロ知識証明とは何か、日本語で短い一文で説明してください。」を一度送信し、OpenRouter `openai/gpt-4o-mini`から日本語の回答を受け取りました。応答表示後はsessionが`closing`になり、新規送信をブロック。明示的な`Check settlement / Recover`後にSDKが精算済みと認め、画面に`Settled · 0.00 USDC`を表示しました。

`formatUsdc`はmicro-USDCの小数を丸めず表示するため、この表示はSDKが返した**0 micro-USDC**です。provider側の最終請求や無償利用を意味しません。[上流のOpenRouter計量方式](https://github.com/yukikm/solana-zkapi/blob/67b05cf30fbd009facb87a3451ae65b1971e86b5/docs/evidence/PD-openrouter-ethereum-parity.md)は、キー無効化から5秒後のmanagement usage観測を採用し、遅延計量のリスクをoperatorが負うとしています。このセッションではprovider管理API・最終invoiceへのアクセスや再課金はしていません。

### ZKAPI-05: 実応答があったsessionのゼロ精算 — 金額の限界として記録

実応答と署名済みゼロ請求を同時に観測しました。SDKが不正な署名を受け入れたという意味ではありません。署名済み金額の検証とprovider最終請求額の一致を区別する必要があります。遅延計量との因果関係を直接検証するには別途operator側の記録照合が必要であり、本セッションでは行っていません。

### ZKAPI-06: 出金の署名回数と進捗がconsumerへ公開されない

実出金中、利用者から「何回も署名とか承認させられてる」と指摘を受けました。現行buffer transportは、`create_payload`、複数の`append_payload`、`seal_payload`、`execute_payload`をそれぞれ別トランザクションにしています。アプリ側の事前説明不足も修正対象です。

読み取り専用RPCで以下の確定を確認しました。途中から記録を開始しており、この一覧は出金全体の全取引・総手数料の記録ではありません。

| 取引                                                                                       | 確定slot  | 結果                           |
| ------------------------------------------------------------------------------------------ | --------- | ------------------------------ |
| `2nXBqLjEhUdXNMohGAirwxGGhoGjk9Gm8SNbNJxM9fAtoUx9ddj3dGCQCYbdytv4J8aw4QDSE5wmfJLviaZT7c94` | 509066009 | AppendPayload成功              |
| `39LtGQHWue2Q3hJivSsP6ETowMSeFzWtm8s2V2jZtVPUeCRa6temczcvhXKph8wftQH4QqLTibAyfRJW88JQMN8L` | 509066400 | AppendPayload成功              |
| `4SraYUnm3neFxEcL9VAhLkFr8EYr2P8jT4qXEgPqaNpgN6CnwdGmdZg4hj2QPgyhDuHTKbv1e1BFY2z1zMxxCHWk` | 509066755 | SealPayload成功                |
| `5qjeNHKAMGdFHSGTiE4WHLkK29uBGu67f3cvMRZpMmgCeCj1aHapFnF73HgmUWGWeyhVmhTLF9zBYLMBQis2A4AR` | 509067610 | ExecutePayload成功、2 USDC返却 |

公開`ClientStatus.walletOperation`は`kind`、`phase`、`signature`、`destinationOwner`だけで、内部journalにあるstep/planをconsumer向けstatusへ公開していません。そのため、通常の`mutual_close / ready`だけでは何回目か判断できません。アプリでSDKの非公開journalを解析して補ってはいません。

さらに`WalletClient.advance()`は署名済み取引を確認する経路でも、期限切れuploadが確定しない場合に`refreshExpiredUpload`を通じて再署名する可能性があります。アプリの確認ボタンにはこの例外を表示しました。

上流への改善提案:

- 安定したpublic statusとしてtransport、現在のstep種別、step番号、全step数、完了数、次の呼び出しが署名を必要とするかを公開する。
- 署名を一切要求しない確認APIと、期限切れuploadの更新・再署名APIを分離する。
- consumerガイドで、入金のinline経路と出金のbuffer経路の承認回数・手数料の違いを操作前に説明する。
- 署名回数削減を検討する場合も、各段階の確定条件と期限切れ復旧を保つ設計を提示する。アプリから未確認の取引を一括署名させて回避しない。

本セッションでは上流SDK・プログラムを変更していません。

## 最終検証

- 公開SDK archive SHA-256一致、`npm run build`（TypeScriptを含む）成功。
- 単体テスト **88件 / 5ファイル成功**。通常のブラウザE2E **20件成功**、公開ネットワーク専用2件は通常実行ではskip。
- 公開ネットワーク専用 **2件成功**。専用port 5184・空のVite cache・隔離Chromiumで検証し、初回Workerロード時のリロードが起きず、実SDKの保存領域作成と再接続まで成功。
- `npm audit --omit=dev`: production dependenciesの既知脆弱性0件。
- [結果一覧](evidence/verification-20261009.json)、[初回起動での公開preflight](evidence/browser-preflight-cold-20261009.json)、[公開SDKの保存領域作成・再接続](evidence/browser-custody-cold-20261009.json)・[画面](evidence/browser-custody-cold-20261009.png)。当初のViteリロード失敗は[別の証跡](evidence/browser-initialization-reload-20261009.json)として保持。

実ウォレットで確認した有資金の処理は1 sessionの入金→応答→精算→通常出金です。複数利用者の同時実行、継続稼働、Mainnet、provider最終invoice、実資金でのescape/challenge/期限切れの全分岐は未検証です。ポータブルbackupも未実装のため、一般向け本番運用の完成を意味しません。

## 2026-10-09追加: 再入金と複数Deposit

画面上部に常設の`Deposit`を追加しました。出金済み・残高不足でも`Add deposit`から新しいnoteを作成し、同じウォレットで入金を続けられます。現行SDKの`prepareDeposit`はnoteの新規作成であり、既存noteへの継ぎ足しAPIではありません。各Depositの残高は合算せず、`Saved deposits`で利用・出金対象を明示的に選びます。

初回note ID・storage名・profile bindingを維持し、追加IDと選択状態は同じSDK暗号化保存領域のcatalogへ保存します。SDKに署名可能な操作を依頼する前にIDを永続化します。過去のnoteを削除せず、残高と履歴はSDKが保持します。未確定取引・未精算・緊急出金中は追加/切替を拒否します。複数タブの操作と選択は同じWeb Lockで直列化し、選択が変わった古い接続からの操作を拒否します。

暗号化catalogの再読込・破損時停止、残高不足/出金後の追加、元の残高保持、保存失敗、未確定操作の継続、別タブ競合は自動テストで確認しました。単体107件・通常画面テスト25件が成功し、型チェック・本番ビルド・SDK archive hashの照合も成功しました。公開ネットワーク用のopt-inテスト2件は通常画面テストではスキップしています。UIテストでは追加→準備→再読込→署名/確認→チャット→残高不足案内をfixtureで検証し、375/768/1280pxで確認しています。

実Chrome/Solflareでは元の出金済みDeposit 1の復元、新しいDeposit 2の作成、ページ再読込後のDeposit 2復元、Deposit 1への切替とDeposit 2への復帰まで確認しました。[実画面の入金フォーム](evidence/redeposit-form-20261009.jpg)を残しています。この追加検証では署名・送金・AUTH・推論を実行していません。

OpenRouterはGPT-4専用ではありません。固定profile（SHA-256 `449657cc3fe90f12878236b83d68ada8077e3c56e67ccb8268c5f301e69e02e5`）の`models`と`modelCapabilities`が`openai/gpt-4o-mini`のみのため、UIも1件です。公開profile/catalog側で許可されたモデルを増やす必要があり、この修正で許可外モデルを注入してはいません。
