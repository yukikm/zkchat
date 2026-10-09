# Solana zkAPI 外部アプリ統合レポート

調査日: 2026-10-07。対象: 公開 `v0.2.0-devnet.1`。

## 結論

公開SDKを独立したアプリにインストールできました。証明・ウォレット・課金・復旧のブラウザ向けAPIは公開されています。一方、リリースには既定の公開operatorと完全な証明用バンドルがなく、公開配布物だけで実AI応答・Devnet課金まで到達できません。このアプリは公式SDK接続コードを備えますが、実接続成功は未検証です。UIデモはサンプル返答です。

上流 `solana-zkapi` 本体を変更せず、ローカル本体checkout・非公開鍵・運用環境にアクセスせずに作成しました。参照は公開ドキュメント、リリースパッケージ、公開型契約のみです。別の参考チャットアプリのソースも使用していません。

## 配布物

| 項目       | 確認内容                                                           |
| ---------- | ------------------------------------------------------------------ |
| Release    | `v0.2.0-devnet.1`, prerelease / immutable                          |
| Commit     | `088ca40bf5886738f87b4db97205db8bff752356`                         |
| SDK        | `@zkapi/solana-sdk` `0.2.0-devnet.1`                               |
| 配布       | GitHub Release npm tarball、registry未公開                         |
| サイズ     | 112,723 bytes                                                      |
| SHA-256    | `e6ff141b1c13c278f1c6d80dbe1397f187290270c583a32545df5fe4fbd45019` |
| Solana Kit | `8.4.0`                                                            |
| Node契約   | `>=24.19.0 <25`                                                    |

ダウンロードしたファイルのSHA-256はGitHub Release APIの値と一致しました。これは第三者監査やプログラム安全性の証明ではなく、今回リリース署名を検証したという意味でもありません。

出典: [release](https://github.com/yukikm/solana-zkapi/releases/tag/v0.2.0-devnet.1)、[release API](https://api.github.com/repos/yukikm/solana-zkapi/releases/tags/v0.2.0-devnet.1)。

## 統合方法

`loadDeploymentAssets` に独立して固定したdescriptor SHA-256を渡し、公開bundleを検証。Wallet Standardでユーザーが選択したウォレット・アカウントを `walletStandardAdapter` に渡し、`createBrowserClient` でmanifestとチェーンを検証します。初回保存領域作成は明示的操作のみ、通常再開は同じIDです。Workerはアプリに同梱した `@zkapi/solana-sdk/prover-worker` をバンドルします。

入金は `prepareDeposit` → `advanceWallet`、送信は `canRequest` → UUIDv4 → `chat`、応答は `readChatDeltas` / `readChatText` で一度だけ消費。未完了時は明示的な `recover`、出金は `prepareWithdrawal` → `advanceWallet`。推論の自動再送やdirect→proxyへの自動切り替えは行いません。

出典: [quickstart](https://github.com/yukikm/solana-zkapi/blob/v0.2.0-devnet.1/docs/sdk/quickstart.md)、[API](https://github.com/yukikm/solana-zkapi/blob/v0.2.0-devnet.1/docs/sdk/api.md)、[distribution](https://github.com/yukikm/solana-zkapi/blob/v0.2.0-devnet.1/packages/sdk/DISTRIBUTION.md)。

## 実接続に不足しているもの

- 公開bundle URLと独立して認証したSHA-256。
- 署名済みmanifest、trust policy、IDL、request/withdrawal/tree証明・検証キー、tree source/verifier constants、追加アセット、固定したWASM。
- 起動済みcontrol/indexer/inferenceサービスとbrowser-safe RPC。
- manifest固定の料金表、対応モデル、direct時のprovider base/OA verifier。
- 配置と一致するDevnet資金、SOL手数料、provider利用契約。

clientdも公開されていますが、これを取得しても上記不足は解消しません。過去の成功証跡は、今利用できるサービス設定の代わりにはなりません。

出典: [release scope](https://github.com/yukikm/solana-zkapi/blob/v0.2.0-devnet.1/docs/releases/kit-preview.md)、[deployment](https://github.com/yukikm/solana-zkapi/blob/v0.2.0-devnet.1/docs/sdk/deployment.md)。

## 利用開始時に分かった制約

- 整数micro-USDC。SOL手数料は別。authorization capは実請求額と別で、少額課金後にも次の認証分の残高が必要。
- 各リクエスト後にsessionを閉じる。表示完了は精算完了とは限らない。
- 推論の自動再試行なし。新UUIDの再送は別の請求可能な操作。
- `chat()` はテキストChat Completions用。Anthropic Messages / Responsesは別の `request()` API。本アプリはChat Completionsモデルのみ選択可能。
- streaming可否はproviderとdeploymentに依存し、画面にモデル名を足すだけでは利用できない。
- 暗号化journalに送信した会話が残る。画面の履歴削除とは別。
- ブラウザcustodyには移植可能なバックアップUIがなく、origin/profile/wallet/note/pinsを保持する必要がある。
- directでもproviderが内容を見て、proxyではoperatorも見る。ZKは回答やprovider計量の正しさを証明しない。
- mainnet・第三者監査・公開operator稼働保証のリリースではない。

出典: [recovery](https://github.com/yukikm/solana-zkapi/blob/v0.2.0-devnet.1/docs/sdk/recovery.md)、[support/evidence](https://github.com/yukikm/solana-zkapi/blob/v0.2.0-devnet.1/docs/sdk/status.md)。

## 検証範囲

検証コマンドは `npm run verify:sdk`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`。E2Eの通常ケースは実画面のローカルデモ、未精算・復旧のケースはテストだけで差し替えたadapterと公開SDKの実SSE parserを使用します。これらは実provider応答、実wallet署名、Devnet入金・課金・出金成功を意味しません。

実サービス設定が公開されたら、同じnoteで「入金→複数ターン→中断→復旧→出金」を実行し、確定取引と検証済みsettlementを記録する必要があります。

## この作業での実行結果

- 公開SDK tarballのSHA-256照合: 合格。
- TypeScript・Vite本番ビルド（SDK/Markdownを分割、module Worker出力を含む）: 合格。
- Vitest: 49件合格。金額のu64境界、壊れた履歴、未完了文脈の除外、設定のDevnet制限、未検証URL・重複JSONキー拒否など。
- Chromium E2E: 11件合格。会話保存・検索・改名・削除・書き出し、明示デモ、オフライン、生成停止、Markdown安全性、375/768/1280px、ダークモード、Escapeでのフォーカス復帰。
- テスト専用adapterを使ったE2Eでは、途中切断による送信ブロック、復旧で推論を再送しないこと、新しい送信のUUID、再表示後の拒否取引再準備、未受理proxy送信の照合を確認。provider/Solanaには送信していません。
- `npm audit`: 0 vulnerabilities（実行時点）。
- 実provider推論・実署名・Devnet入出金・ZK証明生成: 公開operator/bundle不足のため未検証。

画面: [デスクトップ](zkchat-desktop.png)、[モバイル](zkchat-mobile.png)。
