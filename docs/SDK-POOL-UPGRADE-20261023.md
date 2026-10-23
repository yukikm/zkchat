# SDK .13・新Pool・Node.js更新

2026-10-23 JST。対象アプリは **zkchat v0.2.0**。この記録は更新内容と再現手順をまとめます。確認済みの結果と未完了の検証・公開作業を下表で分けて記録します。

## 更新理由

上流の[2026-10-21のPoCリセット](https://github.com/yukikm/solana-zkapi/blob/1d5b22e5e76ed32719fa130899a22dc187d7487b/docs/getting-started/poc-state-sync.md)により、公開Devnetは `public-devnet-20261021-state-v1` の新Poolを使用します。旧profileは退役したPoolを認証するため、通常のSDK更新のように同じ保存領域を使い続けることはできません。新Pool用に別の保存領域を明示的に作成し、旧入力と旧データを保持します。

SDKは[公開release v0.2.0-devnet.13](https://github.com/yukikm/solana-zkapi/releases/tag/v0.2.0-devnet.13)の配布物を使用します。新しいcurrent-state同期はサーバー側の変更であり、未公開main版のSDKは組み込みません。通常のChat Completions・streaming・復旧APIを引き続き使用します。[上流の導入手順](https://github.com/yukikm/solana-zkapi/blob/1d5b22e5e76ed32719fa130899a22dc187d7487b/docs/getting-started/sdk.md)

## 固定した入力

| 項目            | 値                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------- |
| SDK             | `0.2.0-devnet.13`                                                                            |
| SDK archive     | `vendor/zkapi-solana-sdk-0.2.0-devnet.13.tgz`                                                |
| SDK SHA-256     | `e6e7668e1d37938f67f8865673aba1a11f27b975d3715a376ac24a6dcfa8a8a9`                           |
| 新profile       | `https://d366buuvadnp3.cloudfront.net/releases/public-devnet-20261021-state-v1/profile.json` |
| profile SHA-256 | `5e15d66c6f45265951cf1f8dd6cc0dae6574c4b8dd6756f828f7543ecaa97b9a`                           |
| deployment      | `public-devnet-20261021-state-v1`                                                            |
| Pool            | `2zAKvvfiV1RZtWw71EYthWVrR3ZiWgmy92DS75JpmG8R`                                               |
| モデル          | `openai/gpt-4o-mini`、direct OpenRouter Chat Completions                                     |
| 回答上限        | 4,096 output tokens。profileと別のアプリ利用上限                                             |
| Solana Kit      | `8.4.0`。SDKの固定依存と一致                                                                 |

profileと配布物の根拠は[上流のDevnet入力](https://github.com/yukikm/solana-zkapi/blob/1d5b22e5e76ed32719fa130899a22dc187d7487b/docs/getting-started/devnet.md)。`npm run verify:sdk` で保持する各SDK archiveのSHA-256を照合します。SDKとprover Workerは同じ配布物からビルドします。

## 旧データの保持と新Poolの初期設定

| 入口             | 実行SDK | 固定設定                             | 保存名                                       | 初回note ID                                       |
| ---------------- | ------- | ------------------------------------ | -------------------------------------------- | ------------------------------------------------- |
| `/`              | `.13`   | `public/zkapi-config.json`           | `zkchat-sdk-public-devnet-20261021-state-v1` | `zkchat-note-sdk-public-devnet-20261021-state-v1` |
| `/recovery-v12/` | `.12`   | `config/zkapi-config.devnet.12.json` | `zkchat-sdk-0.2.0-devnet.8`                  | `zkchat-note-sdk-0.2.0-devnet.8`                  |
| `/recovery-v3/`  | `.3`    | `config/zkapi-config.devnet.3.json`  | `zkchat-sdk-0.2.0-devnet.3`                  | `zkchat-note-sdk-0.2.0-devnet.3`                  |

`.12` の復旧設定は更新前の `public/zkapi-config.json` のbytesを保持します。旧revision-6 profileのSHA-256は `ec10c1ab41bb5105222d3e25c7e1eba6b96b1b397abd0f854657030269992a77` のままです。`.3` の元profile・SHA-256・SDK archiveも保持します。

新Poolは通常画面の明示的な初期設定で作成します。同じアカウントに旧データがある場合も、旧profile binding・暗号化journal・note・catalog・会話履歴を消去したり新Poolへ付け替えたりしません。復旧画面は各世代の既存保存領域に限定し、新規保存領域・新規入金・新規チャットを停止します。保存済みの取引・認可・精算・出金を扱う操作は残します。

旧Poolのサービスは退役しています。旧SDKと保存データを保持しても旧残高の復旧は保証できず、新Poolへの残高移行も行いません。元のURL・ブラウザprofile・アカウントを保持します。上流の単一ユーザーPoCで行われたリセットの例外を、zkchatの既存データを消す許可として扱いません。

## 旧モデルの会話

旧profileは21モデルを含んでいましたが、新profileは `openai/gpt-4o-mini` のみです。会話履歴とそのモデルIDを保持し、現在のprofileにないモデルを選んだ会話では、通常送信・Enter・再送を履歴変更前に止めます。利用できない理由と新規チャットへの案内を表示します。保存済みのモデルを黙って別モデルに変えたり、推論を再送したりしません。

## Node.jsと依存関係

Node **24.22.1 LTS** / npm **11.19.1** を使用します。`.nvmrc`、`engines.node`、`packageManager`を更新し、作業環境のNVM defaultも24.22.1へ切り替えました。SDK `.13` と保持した `.12` / `.3` はNode 24系を要求するため、Currentの26系へは上げません。

24.22.1は[10月21日のセキュリティrelease](https://nodejs.org/en/blog/release/v24.22.1)で、Brotli decoderの範囲外書き込みによるRCE（CVE-2026-111497）、TLS/DNS検証、HTTP、暗号乱数cacheなどの修正を含みます。[公式advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)

既存の指定範囲を保つ依存更新と、Node 24系の型更新を適用しました。更新後のlockfileはReact / React DOM 19.3.1、Playwright 1.64.1、Vitest 5.0.5、Prettier 3.9.10、Noto Sans JP 5.3.1、`@types/node` 24.19.2を含みます。Vite 7.3.7、plugin-react 5.2.0、TypeScript 5.9.3、Solana Kit 8.4.0とwallet plugin 0.21.0は維持します。最終的な依存内容は `package-lock.json` を正とします。

このアプリの本番配信はS3/CloudFrontの静的ファイルです。Nodeサーバーは本番に常駐しないため、Nodeの修正は開発・検証・ビルド環境に適用し、その環境で生成したassetを配信します。別リポジトリのZKAPIサーバーやnative clientd同梱Nodeは今回の変更対象に含みません。

## 再現する検証

```sh
nvm install
nvm use
node --version
npm --version
npm ci --ignore-scripts
npm run verify:sdk
npm audit
npm test
npm run typecheck
npx playwright install chromium
npm run test:e2e
npm run build
node scripts/check-build.mjs
npm run check:aws
npm run check:public -- docs/evidence/public-preflight-20261023-sdk13.json
npm run check:cors -- https://dzt0611ozdx70.cloudfront.net docs/evidence/public-cors-20261023-sdk13.json
npm run check:browser
```

単体・通常E2Eはfixtureで、公開preflight/CORSは読み取り専用です。公開browser検査は隔離したブラウザと署名不能のテストアカウントを使用し、SDK・Worker・WASM・新保存領域の初期化と再接続を確認します。AUTH・推論・署名・入出金を行う確認とは区別します。旧Poolの復旧を新Poolのpreflight成功から推定しません。

## 検証・公開結果

以下は2026-10-23の途中確認です。公開RPCの429に対する読み取り再試行を追加中のため、その変更を含む最終候補の検証はまだ完了していません。未完了の項目を成功や静的サイトの公開済みとは扱いません。

| 項目                                     | 結果                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Node / npm実行版                         | 24.22.1 / 11.19.1を確認                                                                         |
| clean install                            | `npm ci --ignore-scripts` 成功、279 packages                                                    |
| SDK archive検証・npm audit               | 保持した5 archiveのSHA-256と新SDK `.13` のrelease attestationを確認。audit 0件                  |
| 単体・型チェック                         | RPC再試行を含む単体333件・15ファイルと型チェック成功                                            |
| 通常E2E                                  | 74件成功、公開検査用のopt-in 3件は通常実行でskip                                                |
| 3 runtimeのbuild / 配信再現              | `build`、`check-build`、`check:aws` 成功                                                        |
| 新Poolの公開preflight / readiness        | 10項目とreadiness成功                                                                           |
| 公開CORS                                 | 11ルート成功                                                                                    |
| 公開browser                              | 個別実行でpreflight、SDK初期化・再接続、署名前の入金準備に成功                                  |
| CloudFormation Function更新              | `UPDATE_COMPLETE`。入口routingと依存するdistributionを既存リソースのまま更新し、originを維持    |
| S3配信・CloudFront invalidation          | 408ファイル・20,442,852 bytesを配信。invalidation `I13150303LEN5OTINLRNAD3ZA5` はCompleted      |
| 公開bytes・3入口・旧asset / 保存状態保持 | 公開27ファイルのSHA/MIME/cache・routing 9項目・旧asset 8件・3入口・同一origin保存sentinelが成功 |
| Git commit / push                        | 変更と検証記録をmainへコミットし、push後にorigin/mainとの一致を確認                             |

公開browserの入金準備では、約7秒間に読み取りRPCが18回（うち`getBlock`が6回）発生し、HTTP 429を観測しました。認証済みprofileのRPC URLと4種類の読み取りメソッドだけに限定し、10秒待って1回再試行する処理を追加しました。`Retry-After`は15秒まで尊重し、それより長い場合は再試行しません。SDKの期限と中断signalを維持します。再確認では実際の429から回復し、約25秒で署名前の入金準備が完了しました。HTTP 429でpreflight全体を即時に繰り返す処理も停止しています。制限元の詳細は上流が応答を伏せるため特定していません。認可・有料推論・取引送信の自動再送には広げません。ここまでの無資金の初期化・再接続成功を、有資金の入金・推論・精算・出金全体の成功とは扱いません。

2026-10-23 12:47–12:48 JSTに配信と公開検証が完了しました。[公開検証の記録](evidence/deployment-sdk13-20261023.json)。

公開先は既存の `https://dzt0611ozdx70.cloudfront.net`、スタックは `zkchat-static` / `us-east-1` を維持します。`/recovery-v12/` のCloudFront Function routingを追加し、3画面のassetを先に配信してからHTMLを更新します。既存assetは削除しません。実行手順は[AWSデプロイ](AWS-DEPLOY.md)を参照してください。

検証記録: [公開preflight](evidence/public-preflight-20261023-sdk13.json)、[CORS](evidence/public-cors-20261023-sdk13.json)、[browser preflight](evidence/public-browser-preflight-20261023-sdk13.json)、[保存領域の初期化・再接続](evidence/public-browser-custody-20261023-sdk13.json)、[429回復を含む入金準備](evidence/public-browser-deposit-preparation-20261023-sdk13.json)。
