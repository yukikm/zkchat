# SDK 0.2.0-devnet.8 更新確認

SDK更新確認日: **2026-10-10 JST**。公開サービスと上流ドキュメントの追記: **2026-10-11 JST**。対象は[公開release v0.2.0-devnet.8](https://github.com/yukikm/solana-zkapi/releases/tag/v0.2.0-devnet.8)、ソース `fb95814720033fea4075cababe594b6c5bb7de26`。release公開は2026-10-10 04:57 JSTです。mainの未リリースコードは組み込んでいません。

## 上流の変更とアプリの対応

| 変更                                                                                                      | 対応                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.6`: direct sessionを300秒再利用、残り90秒で更新対象                                                     | 会話IDを`chat.sessionId`に渡す。`status.canRequest`が許可するsessionを復旧待ちと区別。明示的な`settle()`で終了できる。複数request分の精算額はsession合計と表示する |
| `.7`: direct requestのidentity/transport情報を制限、OpenRouter ZDR/data collection deny必須、本文保存削減 | 改変していない公開SDKを組み込み、既存のテキストChat Completions形式を維持。送信内容はSDKの検査を通す。Privacy説明を更新                                            |
| `.8`: providerエラーの安全なコード、privacy status、upgrade plan、任意のkeyless ZDR catalog照会           | SDKの既知エラーコードだけをアプリで表示。予算不足を追加入金の案内と区別。推論の自動retry・モデル/モード切替・ZDR緩和は行わない                                     |
| revision-6 profile: SDK `.8` と21モデル、streaming capability                                             | 新規インストール用profileとSHA-256を固定。既存のmodel/capability選択処理を利用。アプリ上限128 output tokensは維持                                                  |
| 既存custodyのin-place migrationは非対応                                                                   | 元の `.3` runtime/profile/storage/noteを復旧版に保持。`.8` から元のcustodyを開いたり、そのアカウントで新規custodyを作って回避したりしない                          |

新しい`upgradePlan()`、`checkModelAvailability()`、`purgeSettledRequestBodies()`はSDKに含まれますが、今回新しいUI操作としては追加していません。status読み取りによるprovider catalogの自動pollや本文削除も追加していません。

出典: [session reuse](https://github.com/yukikm/solana-zkapi/blob/v0.2.0-devnet.6/docs/releases/session-reuse-preview.md)、[privacy](https://github.com/yukikm/solana-zkapi/blob/v0.2.0-devnet.7/docs/releases/privacy-preview.md)、[SDK .8更新ガイド](https://github.com/yukikm/solana-zkapi/blob/v0.2.0-devnet.8/docs/releases/usability-preview.md)。

## 配布物と保存領域

`gh release verify`、`gh release verify-asset`、SHA-256を検証しました。npm registryへの公開ではなく、GitHub releaseのtarballをvendorへ追加しています。Solana Kitは`8.4.0`を維持し、第三者ライセンス一覧も更新しました。

| 項目            | 新規利用 `.8`                                                      | 元の `.3` 復旧                                                     |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| npm import      | `@zkapi/solana-sdk`                                                | Vite recovery modeで`@zkapi/solana-sdk-legacy`へalias              |
| archive SHA-256 | `cd9226f4526c0b3561a557e4c7beb4f495dcbad6c995c624f4c442b6621414da` | `5dfa1d9edf58e6a8b3359cc16d29e55657b6c205e948b7ca1b7b40018e452887` |
| profile SHA-256 | `ec10c1ab41bb5105222d3e25c7e1eba6b96b1b397abd0f854657030269992a77` | `449657cc3fe90f12878236b83d68ada8077e3c56e67ccb8268c5f301e69e02e5` |
| storage         | `zkchat-sdk-0.2.0-devnet.8`                                        | `zkchat-sdk-0.2.0-devnet.3`                                        |
| 最初のnote      | `zkchat-note-sdk-0.2.0-devnet.8`                                   | `zkchat-note-sdk-0.2.0-devnet.3`                                   |

`npm run build`は本体と`recovery-v3/`を生成し、両方の本体・prover Workerのmodule graphに別バージョンが混入していないか検査します。復旧版は同じoriginで配信するため、元のIndexedDBとlocalStorage bindingを使用できます。開発環境では元のサーバーを停止し、同じorigin/ポートで`npm run dev:recovery`を起動します。

`.8` の接続前に、選択アカウントの元のprofile binding・IndexedDB database名・custody key一覧のみを確認します。元のjournalを新SDKで復号せず、profileを書き換えません。元データがあれば復旧版へ案内します。復旧版も元の保存領域がないアカウントの新規作成には使用しません。旧`zkchat-v1`、追加Deposit、未コミットの先行変更も保持しています。

## 検証と制限

- Node `24.19.0` / npm `11.9.0`、SDK archive検証、TypeScript、通常ビルド・`/chat/`サブパスビルド。
- 単体テスト119件。既存profile/journal保護、既知providerエラーのredaction、sessionの再利用可否、元の復旧動作を含む。
- オフラインChromiumで既存25件とSDK更新2件。会話scope・別UUIDでの明示送信・session終了・予算エラー表示を確認。実providerは使用しない。
- 生成済み本体から復旧版への同一origin遷移、両profile pin、SDK表示、保存状態の保持を`/`と`/chat/`で確認。
- Reactの変更を`vercel:react-best-practices`で確認。派生stateはrender時に計算し、新しいnetwork pollやeffectは追加していない。

**2026-10-10 16:48 JSTの記録（過去の結果）:** read-only確認では、`.8` profile・証明assets・21モデルを検証できましたが、preflightは`catalog`で失敗しました。公開`GET /zkapi/v1/catalog`もHTTP 200で`{"models":[]}`を返していました。[検査結果](evidence/public-preflight-20261010-sdk8.json)を保持しています。この空catalogの結果は現在の状態を示すものではありません。

## 2026-10-11追記: catalog復旧と接続状態

上流の[`be8ffc4`](https://github.com/yukikm/solana-zkapi/commit/be8ffc4)で公開catalogが復旧し、固定の試用枠が撤廃されました。ドキュメント再編後の[`2a5c588`](https://github.com/yukikm/solana-zkapi/tree/2a5c588ddde11cd443fbfdca6d531c3267df5111)までSDK本体に追加の変更はなく、zkchatの `.8` archive・revision-6 profile・SHA-256は[現行SDK導入ガイド](https://github.com/yukikm/solana-zkapi/blob/2a5c588ddde11cd443fbfdca6d531c3267df5111/docs/getting-started/sdk.md)と一致しています。元の `.3` 復旧経路と128 output tokensの上限を維持します。

**2026-10-11 01:24–01:25 JSTのread-only再確認:**

- `.8` revision-6 profileを検証し、`/zkapi/v1/models`で21モデル、`/zkapi/v1/catalog`で空でないOpenRouterのwildcard tariffを確認しました。
- `/provider-budget`はschema 2、`budget_scope: operator_funded`、`trial_limits: false`。新規受付と取引は許可されていましたが、`provider_credit: not_checked`でprovider残高は未確認です。[公開Devnet利用条件](https://github.com/yukikm/solana-zkapi/blob/2a5c588ddde11cd443fbfdca6d531c3267df5111/docs/getting-started/devnet.md)でも、受付許可とreadiness・provider容量を区別しています。
- `npm run check:public`は`rpc`で失敗しました。RPCの`getGenesisHash`はHTTP 429（configured upstream unavailable）、readinessはHTTP 503（Indexer unavailable）でした。

**この再確認時点でも公開APIを利用可能とは判定できません。** 空catalogの問題は解消していますが、RPCとIndexerの可用性は別の問題です。利用前には改めて`Check service`で確認します。

有資金の `.8` lifecycle、実ウォレット署名、AUTH、推論・精算・出金は今回実行していません。元の `.3` の有資金検証は[2026-10-09の記録](INTEGRATION-REPORT.md)で、`.8` の実動作を示すものではありません。上流operatorや本番ホスティングへの変更・デプロイは行っていません。
