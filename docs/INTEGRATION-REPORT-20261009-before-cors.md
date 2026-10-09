# Solana zkAPI 第三者チャットアプリ統合レポート

検証日: **2026-10-09 JST**。参照ソース: [`2524e41693a902ec88ef4e350af65a7dc757ef7e`](https://github.com/yukikm/solana-zkapi/tree/2524e41693a902ec88ef4e350af65a7dc757ef7e)。SDK: **0.2.0-devnet.3**。APIの`.4`リリースは招待設定の変更を含むソース公開であり、クライアント配布物は`.3`のままです。

## 結論

チャットアプリを最新の公開仕様に合わせて更新しました。SDKの独立インストール、認証済みprofileと証明用アセットの取得、Nodeからの10項目の公開preflightは成功しました。以前不足していた公開operator・完全なbundleは現在取得できます。

一方、**このアプリのoriginから公開RPCへアクセスできず、第三者が任意のoriginでブラウザアプリを動かすにはoperator側の許可が必要**です。実Chromeおよび隔離ChromiumでRPC段階の失敗を再現しました。`OPTIONS /rpc`はローカルoriginにHTTP 400と`local acceptance request refused`を返し、`Access-Control-Allow-Origin`がありません。公開済み公式アプリoriginにはHTTP 204と対応するCORSヘッダーが返ります。

この制約はgatewayの明示的なorigin許可リストと一致します。SDKの暗号検証バグとは判定していません。第三者導入に必要な運用手続き・開発環境案内の残課題として扱います。**Solana ZKAPIのコード・配布物・operator設定は一切変更していません。** originを偽装した利用やCORS回避の中継も実装していません。

## 今回のアプリ修正

- 公開revision-2 profile URLとGitHubドキュメントに公開されたSHA-256を設定。最初のアセット取得を重複させず、失敗後の再確認を提供。
- `@solana/kit` 8.4.0を維持し、ウォレットの検出・接続・アカウント選択・切断を`@solana/kit-plugin-wallet` 0.21.0へ更新。選択したWallet Standardの元アカウントをSDKの`walletStandardAdapter`へ渡す。自動ウォレット選択・自動署名なし。
- 招待必須の固定条件を除去。`/relay-status`の`invitation_required`と受付状態を確認。招待を必要とする環境の入力欄は詳細欄に保持。
- SDK preflight後に`/zkapi/v1/readiness`を確認。deployment ID / manifest hash / 有効期限とcontrol・indexer・signerの状態を検査し、新規操作直前に再確認。5秒の期限が切れていれば操作を拒否。画面の「最後のチェック結果」は継続稼働保証ではない。
- 資金不要の`Check public connection`、ブラウザorigin/CORSの案内、Devnet faucet・USDC mintの表示、期限表示、緊急出金/照合のUIを追加。
- 元のprofile digest・保存名・note ID・account bindingを維持。新規入金/送信停止中も既存の復旧/出金を残す。中断された送信をpreflight後に開始しない。
- Phantom等の接続エラーをコード別に表示。拒否・未承認・保留要求・内部エラーを区別し、ウォレット接続失敗に残高不足の案内を出さない。
- 通常の回帰テストと公開サービスの読み取り専用テストを分離。既存の会話履歴・Streaming・停止・UUID・未精算の取り扱いを維持。

[Solana公式Frontend案内](https://solana.com/docs/frontend)に従いKitとKit wallet pluginを選択。`web3.js`および旧wallet-adapterを導入していません。

## 公開入力と実測証跡

| 項目                | 値                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| profile             | `https://d366buuvadnp3.cloudfront.net/releases/public-devnet-20261008-a/profile-sdk-0.2.0-devnet.3.json` |
| profile SHA-256     | `449657cc3fe90f12878236b83d68ada8077e3c56e67ccb8268c5f301e69e02e5`                                       |
| SDK tarball SHA-256 | `5dfa1d9edf58e6a8b3359cc16d29e55657b6c205e948b7ca1b7b40018e452887`                                       |
| manifest hash       | `b97e200769be24448a51999346a28d0ca497892d68212f517b2b9bb4cc1a4643`                                       |
| Pool                | `Cx8DbA49UCuASoc3goLCU9ro25eWVtcGMbvfPPJsSQzV`                                                           |
| runtime             | Node 24.19.0 / npm 11.9.0                                                                                |
| route/model         | `direct_openrouter` / `openai/gpt-4o-mini`                                                               |
| cap / output bound  | 1 USDCの認証上限 / 128 output tokens（実請求額とは別）                                                   |

2026-10-09 **12:40:44〜12:41:05 JST**にNodeで実行した[公開preflight結果](evidence/public-preflight-20261009.json)は、profile/assets/manifest/tariffs/genesis/finalized_pool/control_config/catalog/shared_snapshot/chain_clockの10項目が成功。Poolは非停止、受付/復旧はenabled、招待不要、readinessの3サービスavailableを観測しました。provider creditは確認対象外です。

[実ブラウザの失敗記録](evidence/browser-rpc-failure-20261009.json)・[画面](evidence/browser-rpc-failure-20261009.png)、[ローカルoriginのOPTIONS結果](evidence/cors-localhost-20261009.json)、[公開済みアプリoriginとの比較](evidence/cors-published-app-20261009.json)を保存しています。これらは各観測時点の結果です。

## ZKAPI側の残課題（このセッションでは未修正）

### ZKAPI-01: 第三者ブラウザoriginの承認手順 — 実利用の阻害要因

**再現:** `npm run dev` → localhostで`Connection settings` → `Check public connection`。profileとアセットは読み込めますが、SDK preflightの`rpc`で停止します。

```sh
npm run check:public
npm run check:cors -- http://127.0.0.1:5173
npm run check:browser
```

Nodeは成功、origin付きRPC OPTIONSと実ブラウザは失敗します。`https://zkchat.example.com`という未登録のHTTPS originでもHTTP 400を観測しました。一方、既存の`https://d30nr98svcwdoe.cloudfront.net`は許可されます。この比較はOPTIONSのみで、許可されたoriginを装ってアプリを実行したものではありません。

**根拠:** [gateway設定検証](https://github.com/yukikm/solana-zkapi/blob/2524e41693a902ec88ef4e350af65a7dc757ef7e/scripts/public_devnet_gateway.ts#L61)は明示的なHTTPS originのみを受け付けます。[運用runbook](https://github.com/yukikm/solana-zkapi/blob/2524e41693a902ec88ef4e350af65a7dc757ef7e/deploy/public-devnet/README.md)には`allowedBrowserOrigins`が記載されていますが、consumer向けに任意の新しいアプリoriginを登録する具体的な依頼先・手順・ローカル開発方法は不足しています。「招待不要」は「すべてのブラウザoriginを許可」と同義ではありません。

**必要な対応:** operator側で開発者のHTTPS originを審査・登録する手順を公開し、RPC/quote/AUTH/recovery/withdrawalを含む必要ルートのCORSをそのoriginで検証すること。HTTP localhostは現gateway設定スキーマに適合しないため、単にlocalhostを追記する提案にはしません。対応は別セッションでZKAPI側にて判断してください。

### ZKAPI-02: consumerドキュメントのバージョン・招待説明の不整合

[quickstart](https://github.com/yukikm/solana-zkapi/blob/2524e41693a902ec88ef4e350af65a7dc757ef7e/docs/sdk/quickstart.md)はインストール例が`.2`のままです。[public-profile](https://github.com/yukikm/solana-zkapi/blob/2524e41693a902ec88ef4e350af65a7dc757ef7e/docs/sdk/public-profile.md)にも`.2`中心の記述があり、[funding guide](https://github.com/yukikm/solana-zkapi/blob/2524e41693a902ec88ef4e350af65a7dc757ef7e/docs/sdk/devnet-funding.md)はinvitation-only campaignと招待取得を説明しています。一方、[現行公開ガイド](https://github.com/yukikm/solana-zkapi/blob/2524e41693a902ec88ef4e350af65a7dc757ef7e/docs/sdk/public-devnet-preview.md)と実APIは`.3`/招待不要です。

**必要な対応:** consumerの開始点で現行SDK・profile・招待条件を一貫して示し、古いcampaign説明を履歴として明確に分離すること。このアプリでは現行公開ガイドの`.3`入力とlive relay設定を採用しました。

### ZKAPI-03: 公開受付とprovider容量の可視性

`admission: enabled`とreadiness成功はprovider残高や追加AUTHの成功を保証しません。現profileにはtoken上限を機械的に読むフィールドがなく、公開ガイドの128 tokensをこのアプリでも上限にしています。一般的な複数deployment対応には上限・予算範囲の取得/説明方法が必要です。

追加のprovider-cost照合・ブラウザのfunded acceptanceは上流でも限定的な範囲として扱われています。今回これらの不具合を新たに再現したわけではなく、未検証事項です。ZK証明から最終provider請求額の正しさまでは主張しません。

## アプリ側の検証範囲

- `npm run build`: TypeScript・本番ビルド成功。`npm run verify:sdk`: 配布archive一致。
- `npm test`: **86件成功**。`npm run test:e2e`: **16件成功・公開live検証1件は通常実行ではskip**。live検証を明示実行した結果は前述のCORS失敗。
- `npm audit`: 脆弱性0件。lockfileに`@solana/web3.js`なし。
- Kit connectorはテスト用Wallet Standard walletで、検出→接続→明示account選択→元accountとの同一性→切断を実ブラウザで検証。これは実Phantom署名の成功ではありません。実ChromeではPhantom等の検出を確認しました。
- 生成応答/精算/復旧のE2Eはfixtureです。公開サービスの実推論成功とは区別します。
- 公開SDKのNode preflightと実ブラウザCORS失敗を両方記録。storage作成前に停止し、AUTH・推論・入金・出金を行っていません。秘密鍵・provider管理キーは取得していません。
- バックアップUI、出金後の新note作成UI、client-side tool実行ループは未実装。現在はChat Completionsのテキスト会話を対象にします。

## 実Phantom接続で見つかった別の障害

ユーザーがPhantom確認画面でConnectを承認した後、Wallet Standardの`standard:connect`がPhantom拡張機能内の`solana.js`から`Unexpected error`を返しました。`127.0.0.1`に加えて`localhost`でも再現し、後者ではコード **`-32603`** を確認しました。[Phantom公式エラー一覧](https://docs.phantom.com/solana/errors)では内部エラーです。

Phantom本体はロック解除済み・testnetモードでしたが、資産取得失敗の表示もあり、一度再試行しても解消しませんでした。内部エラーの根本原因は特定できていません。ウォレットの初期化・データ削除・再インストール・拡張機能設定変更は行っていません。

これは**ZKAPI接続前**の失敗で、上記RPCのCORSとは別件です。ZKAPI側の不具合には分類していません。[実測記録](evidence/phantom-connection-error-20261009.json)を保存しました。アプリ側ではコードと次の行動を表示するよう修正し、Kit connector経由の成功・拒否と画面表示をテストしています。実Phantom接続の成功は未確認です。

## CORS承認後に残る受け入れ検証

同じorigin・wallet・profile・noteで、Devnet入金→2ターンの実AI応答→各署名済み精算→Streaming中断→明示復旧（推論再送なし）→出金の確定取引を記録する必要があります。ユーザーからウォレット検証可能との回答は得ていますが、今回のRPC拒否が先に発生するため資金操作には進んでいません。未確認の機能を成功扱いにはしていません。

[2026-10-07の旧レポート](INTEGRATION-REPORT-20261007.md)は履歴として保存しました。旧報告の「公開operator/bundle不足」は当時の`.1`に関する記述であり、現状の不足項目は上記CORS/導入手順です。
