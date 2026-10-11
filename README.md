# zkchat

Solana zkAPIをLLMバックエンドにするReactチャットアプリです。新規利用は公開SDK **0.2.0-devnet.8** とrevision-6の認証済み公開Devnet profileを使います。既存の `.3` 保存領域には元のSDK・profileを使う復旧版を同梱しています。Solanaは **`@solana/kit` 8.4.0**、ウォレット接続は **`@solana/kit-plugin-wallet` 0.21.0 / Wallet Standard**。`web3.js`は使用しません。

**2026-10-10 SDK更新:** `.8` の配布物とGitHubリリース署名を確認し、セッション再利用、会話単位のsession ID、ZDR必須化に伴うエラー表示へ対応しました。[更新内容と検証範囲](docs/SDK-UPGRADE-20261010.md)を参照してください。

**公開サービスの最終確認（2026-10-11 01:24–01:25 JST）:** 公開catalogの空応答は解消し、モデル一覧21件と空でないcatalogを確認しました。一方、公開preflightはRPCで失敗し、RPCはHTTP 429、readinessはHTTP 503（Indexer unavailable）でした。この時点では利用可能と判定できていません。利用前に`Check service`で再確認してください。`.8` の有資金での入金・推論・精算・出金は未検証です。

**2026-10-09のSDK .3での検証（過去の結果）:** CORSは解消済みです。localhostから公開preflight 10項目に成功し、実SolflareでSDK初期化・2 Devnet USDC入金・実AI応答・精算・2 USDCの出金完了まで確認しました。Phantomの接続内部エラーは、Kit/ZKAPIを使わない接続でも再現し、別の環境問題として記録しています。[検証結果・ZKAPI側の残課題](docs/INTEGRATION-REPORT.md)を参照してください。

## 起動

Node 24.19.x / npm 11.9.0（`.nvmrc`）を使用します。

```sh
npm ci --ignore-scripts
npm run verify:sdk
npm run dev
```

[localhostのアプリ](http://localhost:5173/)を開きます。`Connection settings` → `Connection details` → `Check service`で、資金や署名なしで公開サービスを確認できます。公開APIは現在、localhostおよびHTTPSのorigin登録を必要としません。通信は`credentials: "omit"`です。`Try the demo`はローカルのサンプル応答です。

**保存先のoriginを固定してください。** `localhost:5173`と`127.0.0.1:5173`は別の保存領域です。今回のSolflare実検証は`http://localhost:5173`を使用しました。残高や未完了操作がある場合は、同じURL・ブラウザprofile・アカウントを使います。

## 既存の `.3` 保存領域を開く

元のSDK・profile・note ID・暗号化journalを置き換えません。`.8` 側は同じアカウントの `.3` profile binding / custodyを検出すると初期化を止めます。

- ローカル: 開いている開発サーバーを停止して `npm run dev:recovery` を実行し、**元と同じURL・ポート・ブラウザ・アカウント**で再接続します。カスタムポートを使っていた場合は `-- --port 元のポート` を付けます。
- 本番ビルド: `Connection settings` → `Have an older deposit?` → `Recover an older deposit` を開きます。`/recovery-v3/`（サブパス配信ならその下）に元の `.3` SDKとprofileを同梱します。同じoriginなので元の保存データを参照できます。
- 既存アカウントはこのoriginでは復旧版を使用します。新しいprofileへの付け替えや、旧データの削除で更新しないでください。新環境への移行前には[上流の更新ガイド](https://github.com/yukikm/solana-zkapi/blob/v0.2.0-devnet.8/docs/releases/usability-preview.md)に従い、すべての元のnoteの復旧・精算・出金/閉鎖を元のSDKで完了し、復旧資料を保持します。

## 実際の使い方

1. `Connect wallet`を開き、検出されたウォレットをプルダウンで選んで`Connect wallet`。拡張機能で承認したアカウントのアドレスがヘッダーに表示されます。アプリでアドレスを選び直す必要はありません。初回だけ`Set up this wallet`で入金データの保存設定へ進みます。接続・保存領域作成は送金しません。
2. [Circle faucet](https://faucet.circle.com/)でUSDC / Solana Devnet、[Solana faucet](https://faucet.solana.com/)でDevnet SOLを用意します。認証済みUSDC mintは`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`。SOLは手数料・rent用です。
3. 保存領域の注意事項を読み、例として2 Devnet USDCを`Review deposit`で準備します。`Approve in wallet`でウォレットに進み、内容を確認して署名します。送信後は`Check transaction`で保存済み取引を確認します。`pending`は未確定です。
4. 「Ready to chat」になったら送信します。モデルは固定profileの許可リストから選択します。direct OpenRouter、アプリの上限は128 output tokensです。Streaming設定は認証済みprofileに従います。
5. 公開profileを使う `.8` のdirect OpenRouter sessionは、Gatewayが受け付ける60秒のleaseを明示指定します（SDK標準の300秒はこのGatewayに拒否されます）。同じ会話は同じsession IDを使い、新しい会話では分離します。別の会話へ送信する前には、前の会話のsessionを`Manage session`（別会話では`Review settlement`）→ `Settle charges`で明示的に閉じます。下書きは保持され、精算後に改めて送信します。Deposit切替・出金も精算後に進みます。応答が中断したら`Check status`で接続画面を開き、`Refresh status`と表示された次の操作で確認します。確認待ちのsessionがあれば`Check payment`で復旧します。推論は再送しません。新しい送信は新しいUUIDを使う別の操作です。

新しい会話では、固定profileに含まれる場合に `openai/gpt-6.1-sol` を初期選択します。選択済み・保存済みの会話モデルは自動変更しません。モデル一覧は利用成功の保証ではありません。送信前の読み取りチェックは通信障害時のみ一度再確認し、検証できない状態では新規送信を止めます。招待が必要という案内は、サービスが実際に招待を要求している場合に限ります。6. 精算後に`Withdraw balance` → `Review withdrawal`で準備します。**現行SDKの出金は複数回の署名が必要**です。証明buffer作成 → 分割アップロード → 封印 → 出金実行の各取引に署名とネットワーク手数料が発生します。アップロード回数はpayload量次第で、公開APIには総数・現在段階がありません。署名ボタンと送信済み確認ボタンを使って一段ずつ進め、`Withdrawal complete`まで同じnoteを保持します。

**追加のDeposit / 出金後の再入金:** 画面上部の`Deposit` → `Add deposit`で新しい入金先を作成し、金額入力 → `Review deposit` → ウォレット署名 → 送信済み取引確認と進みます。同じウォレットで繰り返し利用できます。SDKは既存noteへの継ぎ足し・残高合算に対応しないため、各入金は独立したnoteです。`Saved deposits`で利用・出金する入金を選択します。前の残高と履歴は保持され、出金済みnoteも削除しません。未確定取引・未精算セッション・緊急出金がある間は追加と切替を止め、元の操作を完了します。残高が認証上限を下回ったら`Add funds`の案内から追加できます。

**モデル:** OpenRouter自体は複数providerのモデルを提供します。zkchatは認証済みZKAPI公開profileのモデル一覧・capabilityを使い、新規 `.8` 用profileには21モデルとstreaming capabilityが含まれます。元の `.3` profileは`openai/gpt-4o-mini`だけです。公開catalogの整合性検査に失敗している間は送信できません。ZDR catalogへの掲載だけでも、providerの権限・予算・推論成功は保証されません。追加モデルはoperatorが公開profileと対応catalogを更新する必要があります。アプリ側で未許可のモデル名を追加して制限を回避しません。

送信済み確認は通常追加署名を要求しませんが、現行SDKは期限切れアップロードを更新する場合に再署名を要求することがあります。確認だけを保証するAPIの追加を残課題に記録しています。出金完了後、過去の精算残高を利用可能なcreditsとして表示しません。

受付停止・Pool pause・readiness失敗では新規入金/送信を止めます。元の保存領域での復旧/出金は残します。SDKの条件に応じて未送信AUTH取消、期限切れsetup照合、未署名出金からescapeへの切替、緊急出金、challenge照合、期限後のfinalizeも表示します。

認証上限1 USDCと実請求額は別です。初回請求後も次の認証上限を満たす残高が必要です。Devnetトークンはテスト資金ですが、provider費用はoperatorが負担します。[現行の公開Devnet利用条件](https://github.com/yukikm/solana-zkapi/blob/2a5c588ddde11cd443fbfdca6d531c3267df5111/docs/getting-started/devnet.md)では固定の試用枠はありません。`provider_credit: "not_checked"`はprovider残高が未確認という意味で、公開受付の有効表示はprovider容量の保証ではありません。

## 接続の切り分け

- **Phantom `-32603`:** ウォレット内部エラーです。今回、直接Wallet Standardでも再現し、同じoriginのSolflareでは成功しました。追加入金で接続エラーを解決しようとしないでください。
- **Chain connection:** RPC/ネットワークの確認失敗です。これだけでCORSが原因とは判断できません。
- **Finalized chain snapshot:** SDKがsnapshotを検証できませんでした。元の保存データを保持し、サービス回復後に接続チェックをやり直します。
- **未確定取引 / 精算待ち:** 新しい入金や再送ではなく、保存された操作の`Check status` / `Recover`を使います。

開発時の[Wallet Standard単体診断](http://localhost:5173/wallet-check.html)は、明示的に選んだウォレットへの接続だけを行います。Kit/ZKAPI・署名・送金・保存領域作成は使用せず、ウォレット拡張とアプリの問題を切り分けます。この診断ページは通常の本番ビルドに含まれません。

## 検証コマンド

```sh
npm run verify:sdk
npm test
npm run build
node scripts/check-build.mjs
npx playwright install chromium
npm run test:e2e
```

通常のE2Eはfixtureを使用し、実providerや資金を使いません。以下は公開ネットワークを使う診断です。

```sh
npm run check:public -- docs/evidence/my-preflight.json
npm run check:cors -- http://localhost:5173 docs/evidence/my-cors.json
npm run check:browser
```

`check:public`は公開SDKの10項目とreadinessを検証します。`check:cors`は認証済みprofileから導出した10ルートへ指定originのOPTIONSを送り、必要なmethod/headerを照合します。金融API本体へはPOSTしません。

`check:browser`は隔離Chromiumで実サービスを検査します。接続検査に加えて、署名できないテスト用Wallet Standardアカウントで公開SDK・Worker・WASM・IndexedDBの初期化/再接続を検証します。初回Workerロード時のVite再読み込みを避けるため、Worker依存を起動時に最適化します。ローカル保存領域は作りますが、入金・AUTH・推論は禁止するネットワークガードを使用します。通常E2Eと実ウォレットの有資金検証は別の範囲です。

## 固定設定と保存

[現行SDK導入ガイド](https://github.com/yukikm/solana-zkapi/blob/2a5c588ddde11cd443fbfdca6d531c3267df5111/docs/getting-started/sdk.md)のSDK `.8`、revision-6 profile、独立公開SHA-256を`public/zkapi-config.json`へ固定しています。復旧版は`config/zkapi-config.devnet.3.json`の元のrevision-2 profileを使用します。`verify:sdk`で両方のvendor archiveを公開SHA-256と照合できます。配布元はnpm registryではなくGitHub releaseです。

新規 `.8` は保存名`zkchat-sdk-0.2.0-devnet.8`、初回note ID`zkchat-note-sdk-0.2.0-devnet.8`を使います。復旧版は`zkchat-sdk-0.2.0-devnet.3` / `zkchat-note-sdk-0.2.0-devnet.3`を維持します。追加noteと選択状態は各SDKの暗号化catalogに保存します。SDK・Worker・profileを混在させず、旧`zkchat-v1`も消去・移行しません。操作と切替はアカウント・deployment別のWeb Lockで直列化し、別タブで選択が変わった古い接続からの操作は拒否します。

会話表示はlocalStorageに平文で保存します。`.8` はdirectの送信本文をSDK journalに保存せず、proxy本文も送信後に削減しますが、request fingerprintと資金の復旧情報は保持します。旧journalの本文・外部バックアップ・画面の会話履歴は自動消去されません。会話の削除とjournalの削除は別です。OpenRouterにはZDRとdata collection denyを要求し、自動的に緩和しません。これはprovider側の削除やIP秘匿の証明ではありません。directではproviderが、proxyではoperatorも内容を受け取ります。ブラウザ保存はポータブルバックアップではありません。

招待は現行公開APIでは不要です。別の制限付きoperatorで必要な場合は詳細欄に入力し、メモリ中だけで保持します。認証済みcontrol originの正確なsession POST以外には送信しません。provider管理キー、秘密鍵、招待を公開設定へ記載しません。

## 公開ビルド

AWSの最小コスト構成（非公開S3 + CloudFront Free定額プラン）、配信用テンプレート、公開手順は[docs/AWS-DEPLOY.md](docs/AWS-DEPLOY.md)にまとめています。`npm run check:aws`で配信動作をローカル検証し、`npm run publish:aws`でAWSを変更せず配信計画を確認できます。

公開URL: [zkchat](https://dzt0611ozdx70.cloudfront.net) / [旧SDKの復旧画面](https://dzt0611ozdx70.cloudfront.net/recovery-v3/)。2026-10-11にCloudFront Freeプランで公開済みです。外部ZKAPIの稼働確認結果は上記デプロイ手順を参照してください。

HTTPS、Web Crypto、Web Locks、IndexedDB、module Worker、WASM対応ブラウザが必要です。サブパスへ配置する場合:

```sh
npm run build -- --base /chat/
```

`dist/`全体（`recovery-v3/`を含む）を同じパスで配信します。ビルド時に本体とWorkerのSDK混在を検査します。サブパスのブラウザ検証は `node scripts/check-build.mjs --base /chat/` で実行できます。新しいHTTPS originは別保存領域です。既存の資金・未完了操作を新URLへ移行した扱いにしないでください。
