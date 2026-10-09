# zkchat

Solana zkAPIをLLMバックエンドにするReactチャットアプリです。公開SDK **0.2.0-devnet.3** と認証済み公開Devnet profileを使います。Solanaは **`@solana/kit` 8.4.0**、ウォレット接続は **`@solana/kit-plugin-wallet` 0.21.0 / Wallet Standard**。`web3.js`は使用しません。

**2026-10-09再検証:** CORSは解消済みです。localhostから公開preflight 10項目に成功し、実SolflareでSDK初期化・2 Devnet USDC入金・実AI応答・精算・2 USDCの出金完了まで確認しました。Phantomの接続内部エラーは、Kit/ZKAPIを使わない接続でも再現し、別の環境問題として記録しています。[検証結果・ZKAPI側の残課題](docs/INTEGRATION-REPORT.md)を参照してください。

## 起動

Node 24.19.x / npm 11.9.0（`.nvmrc`）を使用します。

```sh
npm ci --ignore-scripts
npm run verify:sdk
npm run dev
```

[localhostのアプリ](http://localhost:5173/)を開きます。`Connection settings` → `Check public connection`で、資金や署名なしで公開サービスを確認できます。公開APIは現在、localhostおよびHTTPSのorigin登録を必要としません。通信は`credentials: "omit"`です。`Try the demo`はローカルのサンプル応答です。

**保存先のoriginを固定してください。** `localhost:5173`と`127.0.0.1:5173`は別の保存領域です。今回のSolflare実検証は`http://localhost:5173`を使用しました。残高や未完了操作がある場合は、同じURL・ブラウザprofile・アカウントを使います。

## 実際の使い方

1. `Connection settings`でウォレットとアカウントを選択し、`Verify connection`。初回だけ`Create storage for this wallet`を選びます。接続・保存領域作成は送金しません。
2. [Circle faucet](https://faucet.circle.com/)でUSDC / Solana Devnet、[Solana faucet](https://faucet.solana.com/)でDevnet SOLを用意します。認証済みUSDC mintは`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`。SOLは手数料・rent用です。
3. 保存領域の注意事項を読み、例として2 Devnet USDCを`Prepare deposit`で準備します。`Continue to wallet signature`でウォレットに進み、内容を確認して署名します。送信後は`Check submitted transaction`で保存済み取引を確認します。`pending`は未確定です。
4. 「Ready to send」になったら送信します。モデルは`openai/gpt-4o-mini`、direct OpenRouter、最大128 output tokens。Streaming設定は認証済みprofileに従います。
5. 応答後も未精算なら`Check recovery` → `Check settlement / Recover`。推論は再送しません。新しい送信は新しいUUIDを使う別の操作です。
6. 精算後に`Withdraw balance` → `Prepare withdrawal to this wallet`で準備します。**現行SDKの出金は複数回の署名が必要**です。証明buffer作成 → 分割アップロード → 封印 → 出金実行の各取引に署名とネットワーク手数料が発生します。アップロード回数はpayload量次第で、公開APIには総数・現在段階がありません。署名ボタンと送信済み確認ボタンを使って一段ずつ進め、`Withdrawal complete`まで同じnoteを保持します。

送信済み確認は通常追加署名を要求しませんが、現行SDKは期限切れアップロードを更新する場合に再署名を要求することがあります。確認だけを保証するAPIの追加を残課題に記録しています。出金完了後、過去の精算残高を利用可能なcreditsとして表示しません。

受付停止・Pool pause・readiness失敗では新規入金/送信を止めます。元の保存領域での復旧/出金は残します。SDKの条件に応じて未送信AUTH取消、期限切れsetup照合、未署名出金からescapeへの切替、緊急出金、challenge照合、期限後のfinalizeも表示します。

認証上限1 USDCと実請求額は別です。初回請求後も次の認証上限を満たす残高が必要です。Devnetトークンはテスト資金ですが、provider費用はoperatorが負担します。公開受付の有効表示はprovider容量の保証ではありません。

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

[現行公開Devnetガイド](https://github.com/yukikm/solana-zkapi/blob/67b05cf30fbd009facb87a3451ae65b1971e86b5/docs/sdk/public-devnet-preview.md)のSDK `.3`、revision-2 profile、独立公開SHA-256を`public/zkapi-config.json`へ固定しています。APIソース`.5`はSDKバージョンではありません。`verify:sdk`でvendor archiveを公開SHA-256と照合できます。

保存名は`zkchat-sdk-0.2.0-devnet.3`、note IDは`zkchat-note-sdk-0.2.0-devnet.3`で維持しています。旧`zkchat-v1`を消去・移行しません。profileを差し替えたり、別noteを作成したりして未完了操作を回避しません。

会話表示はlocalStorage、送信済み本文と資金の復旧情報はSDKの暗号化journalに保存されます。会話の削除とjournalの削除は別です。ブラウザ保存はポータブルバックアップではありません。出金後の新note作成UIは未実装です。directではproviderが、proxyではoperatorも会話内容を受け取ります。

招待は現行公開APIでは不要です。別の制限付きoperatorで必要な場合は詳細欄に入力し、メモリ中だけで保持します。認証済みcontrol originの正確なsession POST以外には送信しません。provider管理キー、秘密鍵、招待を公開設定へ記載しません。

## 公開ビルド

HTTPS、Web Crypto、Web Locks、IndexedDB、module Worker、WASM対応ブラウザが必要です。サブパスへ配置する場合:

```sh
npm run build -- --base /chat/
```

`dist/`を同じパスで配信します。新しいHTTPS originは別保存領域です。既存の資金・未完了操作を新URLへ移行した扱いにしないでください。このセッションでは外部ホスティングやZKAPI側の変更は行っていません。
