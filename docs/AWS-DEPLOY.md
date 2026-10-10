# AWSでの最小コスト公開

2026-10-11時点。zkchatは静的React/Viteアプリなので、**非公開S3 + CloudFront Free定額プラン**で公開できます。EC2、Lambda、API Gateway、DB、独自ドメインを追加しません。ビルドはローカルで行い、`https://….cloudfront.net` を固定URLにします。

既存のZKAPI用CloudFront・S3は共有せず、専用の `zkchat-static` スタックで管理します。

本番ビルド、ローカルブラウザでの配信検証、AWSの `validate-template` が成功しています。公開スクリプトの停止条件とアップロード順序はAWS CLIのstubでも確認済みです。2026-10-11に実AWSで専用リソースを作成し、Subscriptionが `ACTIVE` / `FREE` であることも確認しました。

## デプロイ先

| 項目                    | 値                                                |
| ----------------------- | ------------------------------------------------- |
| サイトURL               | https://dzt0611ozdx70.cloudfront.net              |
| 復旧画面                | https://dzt0611ozdx70.cloudfront.net/recovery-v3/ |
| CloudFormation          | `zkchat-static` / `us-east-1`                     |
| CloudFront distribution | `E3OT9UOJBXFFK5`                                  |
| 非公開S3バケット        | `zkchat-static-sitebucket-4chfrmlwl1lh`           |
| 初回アップロード        | 272ファイル、13,010,168 bytes                     |

更新時はこのスタックとURLを維持し、後述の `publish:aws` を使います。

2026-10-11 02:09 JST時点でCloudFormationは `UPDATE_COMPLETE`、CloudFrontは `Deployed` / enabled、Subscriptionは `ACTIVE` / `FREE` です。S3の公開ブロック4項目と非公開bucket policy、アップロード数・容量の一致も確認しました。実URLの配信24項目（ファイルSHA、MIME/cache、HTTPS、復旧ルート、欠落ファイル）と、隔離ブラウザでのデモ返信・復旧版SDKへの遷移・同一origin保存を検証済みです。ブラウザ検証では外部APIを遮断しており、実推論の動作確認は含みません。

02:10 JSTには、設定を差し替えない通常のブラウザ起動でも公開profileが読み込まれ、`Connect wallet` が表示されることを確認しました。ページ内JavaScriptエラーはありません。ウォレット接続や実推論は行っていません。

## 費用と対象範囲

| 項目                               | 想定                                          |
| ---------------------------------- | --------------------------------------------- |
| CloudFront Free定額プラン          | 月額$0。月100GB転送・100万リクエストの利用枠  |
| S3 Standard保存                    | 5GB分の月次クレジット。現行ビルド全体は約13MB |
| S3 PUT/GET/LIST                    | 別途従量課金。小規模利用では通常少額          |
| ビルド・ドメイン・常時稼働サーバー | この構成では追加費用なし                      |
| ZKAPI operator・RPC・Indexer・LLM  | この静的サイトの配信費用には含まれない        |

したがって**低トラフィックでは、月額ほぼ$0〜$1を目安**にできます。これは見積もりであり、AWS全体の請求額を保証するものではありません。既存ZKAPIのインフラ費用は別です。S3へのアクセス数、保存済みの旧asset量、他のS3利用によるクレジット消費で変わります。プランの利用枠を継続して大幅に超える場合は配信性能が調整されることがあります。

Free定額プランは1アカウント3件までです。AWSのFree Tierアカウントや過去の利用量などによる加入制限があります。加入できなければ公開処理を止め、有料プランへ自動変更しません。WAFの作成からFreeプラン有効化までには短時間の従量料金が生じる可能性があります。

料金・仕様の根拠: [CloudFront料金](https://aws.amazon.com/cloudfront/pricing/)、[プランの対象費用と制約](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html)、[S3料金](https://aws.amazon.com/s3/pricing/)。実行時にも確認してください。

## 配信の仕様

- `infra/aws/static-site.json` はCloudFormationテンプレートです。S3は公開をブロックし、OACで専用CloudFrontからの読み取りだけを許可します。
- スタックは **us-east-1** に作ります。CloudFront用WAFの要件です。閲覧者への配信は世界各地のCloudFrontから行われます。
- Freeプランに必要な専用WAFを作成します。最小構成のため個別の検知ルール・アクセスログ・追加メトリクスは設定していません。
- 初期状態は `DistributionEnabled=false`。FreeプランがACTIVEになり、ファイルをアップロードしてから公開します。
- CloudFront Functionが `/` と `/recovery-v3/` をそれぞれの `index.html` に対応させます。`/recovery-v3` は末尾スラッシュ付きへ転送します。欠落JS/JSONをHTMLに置き換えません。
- HTTPSへ転送し、CloudFront標準証明書とmanaged SecurityHeadersPolicyを使います。Workerは同一origin、WASMは既存の固定済み公開profileから取得します。
- ハッシュ付きassetは1年間immutable。HTMLと設定はブラウザで再検証、CDNでは最大60秒のキャッシュとし、公開時に主要パスをinvalidateします。managed CachingOptimizedの最小TTLは1秒です。
- 古いassetを削除しません。開いたままの画面が旧Worker/chunkを参照するためです。長期運用では保存容量を確認し、不要になった世代を判断して整理します。

**同じCloudFront URLを使い続けてください。** localhostや以前の別URLに保存された会話・暗号化された資金復旧情報は、新URLへ自動移行しません。残高・未完了操作は元のURL/ブラウザ/profileから処理します。復旧版は新しいサイトでも本体と同一originの `/recovery-v3/` に置きます。SDK/profileの制約と復旧手順はREADMEを参照してください。

## 準備とローカル検証

Node 24.19.x、AWS CLI v2、対象AWSアカウントの認証が必要です。初回は `npx playwright install chromium` も実行します。認証情報をこのリポジトリに保存しません。

```sh
npm ci --ignore-scripts
npm run build
npm run check:aws
npm run publish:aws
```

`publish:aws` は `--apply` を付けない限りローカルの配信計画を表示するだけで、AWS APIを呼びません。`dist/` の内容を使うため、必ず公開直前にビルドしてください。サブパス指定のビルドはこのテンプレートでは使用しません。

`check:aws` はテンプレート内のFunctionを使ってS3型の配信をローカルで再現し、入口のrewrite、復旧リンク、SDK/profile分離、保存領域維持、MIME、欠落ファイルを検証します。外部APIへの通信や署名は行いません。実CloudFrontや実推論の動作確認とは別です。

## 初回デプロイ

以下のコマンドはAWSに変更を加えます。対象profileを必要に応じて設定し、`ZKCHAT_AWS_ACCOUNT` は意図する12桁のアカウントIDに置き換えます。CloudFormation/S3/CloudFront/WAF/PricingPlanManagerの作成・読み取り権限と、公開スクリプト用のCloud Control `GetResource` が必要です。

```sh
export AWS_PROFILE=default
export ZKCHAT_AWS_ACCOUNT=YOUR_12_DIGIT_ACCOUNT_ID
aws sts get-caller-identity
aws cloudformation validate-template \
  --region us-east-1 \
  --template-body file://infra/aws/static-site.json
```

対象アカウントを確認後、無効状態でスタックを作ります。既存ZKAPIのスタック名やバケット名は指定しません。

```sh
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name zkchat-static \
  --template-file infra/aws/static-site.json \
  --parameter-overrides DistributionEnabled=false \
  --no-fail-on-empty-changeset

npm run publish:aws -- \
  --stack zkchat-static \
  --account "$ZKCHAT_AWS_ACCOUNT" \
  --apply
```

公開スクリプトは実行中のアカウントIDを照合し、Cloud Controlから取得した現在のSubscriptionが `ACTIVE` / `FREE` で、このCloudFrontとWAFを対象にしていることを確認します。スタックOutputsの過去の状態だけで判断しません。確認に失敗した場合はアップロードしません。

アップロードが成功してから有効化します。先行コマンドが失敗したら、この手順へ進まないでください。

```sh
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name zkchat-static \
  --template-file infra/aws/static-site.json \
  --parameter-overrides DistributionEnabled=true \
  --no-fail-on-empty-changeset

aws cloudformation describe-stacks \
  --region us-east-1 \
  --stack-name zkchat-static \
  --query 'Stacks[0].Outputs' \
  --output table
```

Outputsの `SiteUrl` が公開URLです。作成に失敗した場合はCloudFormationのイベントを確認します。Free Subscriptionの失敗を回避するためにSubscriptionをテンプレートから削除すると従量課金になるので、そのような切り替えは行いません。作成途中で残ったWAFなどの料金も確認します。

## 公開後と更新

公開URLで本体、デモ、`Connection settings` → `Have an older deposit?` → 復旧画面への遷移を確認します。ブラウザのNetworkでJS/WorkerがJavaScriptとして200で返ること、欠落URLがエラーになることも確認します。

新URLに対するAPIのCORSは次で確認できます。金融API本体へのPOSTはしません。

```sh
npm run check:cors -- https://YOUR_DISTRIBUTION.cloudfront.net
npm run check:public
```

公開APIのreadinessはホスティングと独立しています。2026-10-11 01:55–01:58 JSTのデプロイ時確認では、固定済みprofileのSHA検証・WASM取得・新CloudFront originのCORS（10ルート）は成功しました。一方、SDK preflightはsnapshotで失敗し、個別のsnapshot/readiness GETも15秒でタイムアウトしました。relay statusは200でしたが、これだけでは実チャットの利用可能性を確認できません。実際の利用前にはアプリの `Check service` で再確認してください。署名・送金・実推論は実施していません。

通常のコード更新は同じスタック/URLへアップロードします。有効化済みのスタックを作り直す必要はありません。

```sh
npm run build
npm run check:aws
npm run publish:aws -- --stack zkchat-static --account "$ZKCHAT_AWS_ACCOUNT" --apply
```

必要な場合はスクリプト出力の `distributionId` / `invalidationId` を使って `aws cloudfront wait invalidation-completed` で反映を待ちます。初回公開後はBillingでFreeプラン・S3クレジットの適用を確認してください。

スタックの削除・作り直しはURLを変えるので通常の更新には使いません。S3バケットは削除時にもRetainで残ります。廃止するときは残高復旧に必要な元originを確認した上で、Subscriptionの解約状態、CloudFront/WAFの削除、保持されたS3の整理まで確認します。
