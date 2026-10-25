# 入金・復元・出金のUX改善 — 2026-10-25

SDK `.19` の公開後に、その正式な配布物をzkChatへ組み込んだ。既存のprofile、Pool、入金ID、保存領域、復元ファイルは維持している。元の `.12` / `.3` の画面も引き続き同じoriginに残す。

## 修正内容

1. **復元の行き止まり** — 別端末へアクセスが移った場合に、理由と復元入口を表示する。ファイル形式・wallet・接続先・既存bindingを接続破棄前に検証する。切替開始後に中断した場合は復元を続ける画面を保ち、wallet変更とは表示しない。
2. **入金額の確認** — Review depositは編集可能な確認画面だけを開く。Edit amountで戻れ、追加の入金では残高画面にも戻れる。明示的な承認操作からSDKの準備を開始し、署名済み取引を新たな入金として再送しない。
3. **出金中の操作** — 追加の入金と入金切替は共通のSDK状態判定に合わせる。実行できない追加ボタンを表示しない。出金後に別の入金や追加の入金へ戻れる。
4. **バックアップ** — 初回はSave your recovery fileとダウンロードを主操作にする。保存後に確認と続行を出す。普段のチャットでは使わず、データ消失・端末移動時に使うこと、追加の入金も自動保存することを短く説明する。日常の管理ではBackup and recoveryを折りたたむ。
5. **入金一覧と状態表示** — 入金ごとの最後の確認額・状態・日時を表示する。残高は合算しない。一覧取得は選択・資金状態を変更せず、別walletの取得結果を表示しない。接続済みとチャット準備完了を区別し、利用料金が未精算の残高にはLast confirmed balanceと表示する。
6. **出金の進捗** — SDKから証明の準備、送信済み部分数、最終取引などの状態を取得する。遅延出金の終了日時は確定済みチェーン情報から検証し、成功した確認が出金可能を示すまでFinish withdrawalを無効にする。確認失敗時に以前の出金可能状態を残さない。
7. **復元ファイル紛失時** — 元のファイルは再ダウンロードできないこと、利用できるブラウザを保ち、削除前に出金することを案内する。新しい鍵への切替・旧ファイル失効は今回の実装には含めない。並行する入金台帳を作る代替処理は追加していない。

Faucet、証明の説明、AI提供者へのメッセージ送信の説明、チャットの下書きと会話、既存入金の任意バックアップ設定を維持した。旧Poolのページは保存データを開くためのもので、停止中の旧サービスを復活させるものではない。

## SDKと公開物

- [SDK `.19` release](https://github.com/yukikm/solana-zkapi/releases/tag/v0.2.0-devnet.19)
- SDK main commit: `16859f71f501684b86aa778e0e1e3aaf53543844`
- [GitHub検証](https://github.com/yukikm/solana-zkapi/actions/runs/40169716360): success
- SDK tarball SHA-256: `cfdda081148cae2e4ae2d1fe0f821fcbf235f593a55bc50bfc042fb826c09424`
- immutable releaseとSDK・verifierのattestationを検証。正式ダウンロードしたtarballが独立インストールテスト済みの物と一致することも確認した。
- SDKはGitHub tarballとして公開し、npm registryへの公開は行わない。今回の変更にバックエンド・復元サービスの再デプロイは不要。
- [公開物の検証記録](evidence/sdk-withdrawal-status-release-20261025.json)

## 検証

SDKは624テスト、復元サービス12テスト、独立したSDKインストールの346テストとNode.jsのデータ削除後復元テストを通過。SDKのブラウザテストでもローカル保存データ削除後の復元を確認している。アプリの単体テストは431件、ブラウザテストは107件成功。通常テストでスキップする公開接続のopt-in 3件も別途検証し、公開preflight、空の保存領域の作成・再オープン、バックアップ未設定時の入金拒否を確認した。現行版と旧SDK 2版のビルド、同一originでの保存領域保持、CloudFrontルーティング・MIME・旧画面への遷移も検証した。

資金を扱う経路は合成のSDK状態・チェーン・プロバイダーで検証した。公開サービスでは読み取りだけのprofile・設定・RPC確認を実施。実際の入出金や有料チャットを新たに実行した結果ではない。公開側のバックアップ必須チェックでは証明生成を行わず、実証明はSDKのブラウザ・wallet fixtureで別途検証している。

[公開接続とバックアップ必須チェック](evidence/public-browser-backup-guard-20261025-sdk19.json)。

## 画面

以下は現在のUIに合成データを与えた検証画面。ユーザーのwalletや資金は使用していない。

- [初回の復元ファイル保存](evidence/ux-improvements-20261025/backup-initial-mobile.png)
- [保存後の続行](evidence/ux-improvements-20261025/backup-saved-mobile.png)
- [編集できる追加の入金確認](evidence/ux-improvements-20261025/editable-deposit-review-mobile.png)
- [入金一覧](evidence/ux-improvements-20261025/deposit-summaries-mobile.png)
- [出金の証明送信](evidence/ux-improvements-20261025/withdrawal-proof-mobile.png)
- [検証済みの待機終了日時](evidence/ux-improvements-20261025/withdrawal-waiting-desktop.png)
- [ファイルを紛失した場合の案内](evidence/ux-improvements-20261025/backup-lost-file-guidance.png)

## 配信

- 公開サイト: <https://dzt0611ozdx70.cloudfront.net/>
- アプリ実装commit: `c78268852c2fa97c578c94d62f4dc73efbabe2cc`（mainへpush済み）
- CloudFront invalidation: `I4SNBA8FTENDH8T0E478I101Q4`、Completed。
- 27ファイルのSHA-256・MIME・cache設定、9件のrouting、15件の旧asset保持、demo・同一originの旧SDK画面を配信後に確認した。ウォレットや資金は操作していない。
- [配信後の検証](evidence/deployment-ux-improvements-20261025.json)
