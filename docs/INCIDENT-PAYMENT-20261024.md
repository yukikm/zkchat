# 2026-10-24 支払い確認待ちの調査

**後続の再発防止:** 同日16:28:02 JST以降の新規支払いセッションに、
準備失敗の未送信精算と、承認済みの運営負担による不明結果の自動精算を有効化した。
元の支払いへの手動免除とは適用条件が異なる。
[新規支払いの自動復旧](AUTOMATIC-PAYMENT-RECOVERY-20261024.md)を参照。

**最新状況:** 元の支払いは、運営者が不明なprovider費用を引き受ける明示的な
署名付き免除により `SETTLED`、利用者請求0として精算された。元のブラウザの
`Check payment` でも署名済みの後継状態を検証し、`Ready to chat`、残高2.00 USDC、
`This payment is no longer pending. No message was resent.` を確認した。
新しい固有のテストメッセージに `openai/gpt-4o-mini` がdirect経路で
`チャットを再開できました。` と応答した。新しい利用分は `Settle charges` を操作し、
通常の使用量観測に基づく署名付き精算が完了した。画面は
`Settled · 0.00 USDC`、`Ready to chat`、残高2.00 USDCとなった。
以下の未解決・未公開という記述は、それぞれの調査時点の履歴である。

## 利用画面で確認した状態

02:52〜02:53 JSTの報告画像では、実チャットが `Reply interrupted` となり、
`Check payment` 後も支払いが未解決だった。元のブラウザを読み取り確認したところ、
`Payment details` は `closing`、表示残高は2 USDC、通知は
`Payment checked. Follow the status below.` だった。

`Delayed withdrawal options` は任意の復旧操作を表示する欄であり、出金状態の名称ではない。
`Start delayed withdrawal` が表示されており、遅延出金は開始されていない。
`closing` は支払いセッションの終了・精算確認待ちを表す。
表示残高は精算後の課金額を確定するものではない。

## サーバー側の読み取り結果と限界

上流公開サービスの17:48〜17:56 UTCを限定して調査したところ、セッションは1件だった。
作成時刻は2026-10-23 17:51:54.338966 UTC（10月24日02:51:54 JST）。
`direct_openrouter`、`ISSUANCE_UNKNOWN`、`close_requested=true`、
activation時刻・provider key参照・精算結果はいずれもなく、記録上の操作数は0だった。

時刻と症状が一致するため関連が強く疑われるが、ブラウザのrequest IDと照合していない。
このセッションが利用者のものと断定はしない。direct通信はcontrolを経由しないため、
操作数0だけでAI送信がなかったとは断定できない。また、現在のledgerの請求額0は
精算完了や最終的な無課金を証明しない。

キー発行処理の例外内容が保存されず、dispatcherのstderrも破棄される実装のため、
具体的なprovider HTTPステータスや失敗理由は今回の記録から特定できなかった。
復旧にはprovider側のキーの存在・使用状況を照合し、既存の復旧処理で精算を確認する
必要がある。キーが見つからないという結果だけでは未発行の証明にならず、
自動再発行・保存データ削除・強制的な状態リセットは行っていない。

03:01:44 JSTに、稼働中dispatcherの読み取り専用照合経路で元の発行ラベルを確認した。
照合は成功したが、対応するprovider keyは見つからなかった。
この経路はDBの読み取りとproviderへのGETだけを行い、キーの作成・無効化・削除や
支払い状態の更新はしない。現在の実装はこの結果を不明状態として保持するため、
同じ結果のまま `Check payment` を繰り返しても精算を完了できない。
これは未発行や最終的な無課金の証明ではなく、安全な解除には追加の証拠が必要。

## 確認したアプリ側の問題と修正

SDK `.13` の `recover()` が呼ぶ `daemon.start()` は外部サービスの失敗を内部で捕捉し、
未解決状態を保持したまま正常returnする場合がある。アプリはそのreturnだけを根拠に
`Payment checked` と表示していた。

ローカル修正では、処理後の `client.status()` を確認し、未解決なら警告を表示する。
`closing` の見出しを `Settlement pending` に変更し、支払いの終了と出金を区別する。
遅延出金の欄にも任意の操作であり未開始であることを明記する。

SDKの認可・精算・出金処理や再試行動作は変更していない。
この表示修正は上流のキー発行問題を解決するものではなく、調査時点では公開版に未反映だった。

同日05:13〜05:14 JSTにSDK `.15` とともに公開版へ反映し、新しい構造化された復旧結果・診断表示にも対応した。[更新・公開検証記録](SDK-RECOVERY-UPGRADE-20261024.md)。公開作業では元のsessionの復旧・精算は実行しておらず、この問題が解決したとの確認ではない。

## SDK `.15` 公開後の未解決表示

利用者から `Payment is still unresolved. The provider key issuance could not be
confirmed.` と報告された。元の画面を閲覧すると、`closing`、
`ISSUANCE_UNKNOWN`、`Recovery: pending` のままで、具体的なreason codeがなかった。

SDKは `X-Zkapi-Recovery-Diagnostics: 1` を送っていたが、公開APIのCloudFront
origin request policyがこのヘッダーを転送していなかった。OPTIONSは成功しても、
認証付きリクエストで診断が届くことは保証されない。上流の両AWSテンプレートと
回帰テストを修正し、公開環境にも同じポリシー修正を適用した。

単純追加はCloudFrontの10ヘッダー上限で拒否され、自動ロールバックが完了した。
このAPIはviewerの `Accept` を参照せず、gatewayがupstream向けに
`Accept: application/json` を設定するため、未使用の `Accept` を診断ヘッダーに
置き換えた。認証・Origin・CORS・Fetch Metadata・admissionヘッダーは維持した。
キャッシュ、サーバープロセス、支払い状態はこの設定変更の対象ではない。

05:24:59 JSTのSELECTのみの監査では、該当時刻の履歴セッションは引き続き
`ISSUANCE_UNKNOWN`、`provider_key_absent`、`requires_operator_action=true`。
キー参照・有効化・精算レコード・署名済み精算はいずれもなく、発行試行は1件、
停止未確認の試行は0件だった。元の発行エラー診断は残っていない。
ブラウザーのsession IDとの照合は未実施であり、対象の一致は断定しない。

バックグラウンドの復旧は継続するが、キーが見つからない結果だけでゼロ精算は
行わない。必要な追加証拠は元の発行要求に対応するproviderの作成・削除・課金記録、
または保存された確実な発行応答である。診断転送の修正は、この支払いの解除を
意味しない。

再発防止の公開検査 `npm run check:recovery-diagnostics -- ORIGIN [REPORT]` を追加。
存在しないsessionと偽credentialによるGETだけで、ヘッダーなし／値 `1` が404、
不正値 `2` がgatewayで400になることを検査する。修正前は3件とも404となり失敗した。
この検査は実sessionの診断本文や精算完了の確認ではない。

05:26〜05:27 JSTに公開CloudFormationの更新完了、CloudFrontの `Deployed`、
実ポリシーの10ヘッダーを確認した。公開API検査は期待どおり404／404／400で成功し、
CORSも11経路すべて成功した。上流のgateway/relayテスト43件も成功。
[転送検査](evidence/recovery-diagnostics-20261024.json)と
[CORS検査](evidence/recovery-cors-20261024.json)を保存した。
元のブラウザーでは復旧ボタンを操作しておらず、実sessionの診断本文更新は未確認。

## プロバイダーの発行・課金調査（同日昼）

利用者から、プロバイダー記録の確認と支払い解決までの依頼を受けて調査を継続。
OpenRouter管理資格情報は既存ホスト内でのみ使用し、キー一覧・workspace・Activity・
読み取り専用Analyticsを照合した。期限切れ・無効キーを含め、全workspaceの全ページを
確認したが、元の発行intent名と一致するキーはなかった。

発生時刻前後8分と2026-10-23 UTC全日のAnalyticsはHTTP 200、0行、
`truncated=false`。利用件数・課金に加え、別クエリで失敗を含む総リクエスト件数と
gateway/providerの5xxも確認した。当日のActivityも0件だった。
同じアカウントの管理画面でも、10月24日JSTの利用件数0件・課金$0を確認した。
これは記録された利用がない証拠であり、元のキーの未発行または発行後削除を
区別する発行履歴ではない。

画面と監査対象を確実に照合するため、Payment detailsに秘密情報を含まない
Payment referenceを追加して公開した。元のブラウザーで同じSolflare接続・
同じ2 USDCの保存済みdepositを再表示し、参照番号が監査対象sessionと一致した。
型チェック・復旧ブラウザテスト7件・全3ビルドと公開配信検査は成功。
[配信検査](evidence/deployment-payment-reference-20261024.json)を保存した。

調査で上流の別の検索漏れも判明した。OpenRouterは既定で期限切れキーを除外するが、
復旧adapterは `include_expired=true` を指定していなかった。上流ソースに指定を追加し、
後続ページの期限切れキー・重複一致拒否・完全一致・GETのみの回帰テストを追加した。
adapterテスト9件成功、既存DB依存テスト8件skip。この調査時点では修正はローカルのみで未公開。
この条件を加えた実API調査でも今回のキーは見つからず、本件の解除には至っていない。

この調査時点の正規復旧経路には、キーを回収して停止・使用額取得・削除確認を行う経路、
または発行前に停止したことを永続記録で証明する経路がある。本件は発行試行が
send-claimed済みで、後者に該当しない。直接モードに運用者の手動waiver APIはない。
遅延出金もchallengeを受け得るため、支払い解決・チャット再開としては扱わない。

アクセスできる管理API・画面で発行/削除履歴を取得できなかったため、元のキー名・
時刻・読み取り結果を記載したOpenRouterサポート照会文を上流のignored targetに準備。
秘密キー・ウォレット情報は含めない。利用者は「送信せず下書きを残す」を選択したため、
問い合わせフォームには入力せず、サポートへの送信も行っていない。
この調査時点では支払いは未解決、チャットの再開は未確認。推論・出金・強制解除は未実行。
外部の発行履歴、または別途レビューされた正式な精算方式が得られるまで、
現在の証拠だけを使って既存sessionを精算済みに書き換えることはしない。

## 明示的な運営者免除と公開復旧（同日午後）

利用者の依頼に基づき、発行・使用量を不明のまま保持し、運営者が不明なprovider費用を
引き受ける精算方式を実装した。対象session・元の認可・発行試行・checkpoint・
deployment・Pool・manifestに結び付けた承認を署名し、期限と猶予期間の経過、
既存試行の停止確認、未精算状態を検査するローカルCLIで適用する。
通常の復旧から自動的に免除する処理や公開waiver APIは追加していない。

レシートは `waived_unknown` / `UNKNOWN_OPERATOR_LOSS`、利用者請求0、
観測使用量・provider USD・operator lossは `null`。未発行・使用量ゼロ・
provider費用ゼロを証明したことにはしない。署名・上限・session・tariff・
後継状態の暗号検証を維持し、検証成功時だけブラウザの未解決journalを精算する。

SDK `.16` と新しいWASMはローカル復旧プレビューとして公開サイトへ反映した。
GitHub releaseとしての `.16` 公開ではない。13:19 JSTの配信検査ではcurrent・
`.12`・`.3` の配信、既存asset保持、同一origin、ルーティングを確認し、
配信WASMのSHA-256もローカル成果物と一致した。
[公開配信検査](evidence/deployment-sdk16-preview-20261024.json)・
[配信WASM照合](evidence/deployed-waiver-verifier-20261024.json)・
[実装と検証範囲](SDK-OPERATOR-WAIVER-20261024.md)。

Backendの初回更新でmigration 5を適用し、元の金融レコードを保持した。
初回CLI適用は既存の数値表現をcanonical parserが拒否し、金融状態を変更せず停止した。
表現を正規化してから型検証する修正と回帰テストを加え、再ビルドしたcontrold・
signerd・dispatcherdを一致する成果物で更新した。最終ソースmanifestのSHA-256は
`5d7828512bddcb392f7cad597576314034b527ea9ed9acbd4becfa959f127528`。
元のprofile・鍵・claim記録・signer journal・金融レコードを保持した。

明示的な承認の適用後、元のsessionは `SETTLED`、請求0、レシート1件、
署名済み精算ありとなった。元のAUTH予約は保持され、provider発行の再送や出金は
開始していない。Backendの要約は上流checkoutのignored
`target/direct-waiver-20261024-r2/{install-runtime-summary,apply-waiver-summary}.json`
に保存した。元のブラウザでも `Check payment` 後に支払い待ちが消え、
`Ready to chat` と残高2.00 USDCを確認した。

その後、新しい固有のテストメッセージを明示的に送信し、`openai/gpt-4o-mini` が
direct経路で `チャットを再開できました。` と応答した。これは元の失敗メッセージの
再送ではない。`Settle charges` 後、新しいsessionも `SETTLED`、署名済み精算あり、
利用者請求0となった。こちらは免除ではなく `metered` / `OPENROUTER_USAGE` の
レシートで、`provider_reported_usd`・`observed_nano_usdc`・
`operator_loss_nano_usdc` がそれぞれ文字列 `"0"` だった。
有効化とprovider key参照が記録され、発行試行は1件、未停止試行は0件。
終了後の該当keyへのGETは404だった。

ブラウザでは応答本文に加え `Settled · 0.00 USDC`、`Ready to chat`、
残高2.00 USDCを確認した。最終監査要約は上流checkoutのignored
`target/direct-waiver-20261024-r2/final-audit-summary.json` に保存した。
元の金融レコード・claim記録・signer履歴の保持と、signerの再照合成功も確認した。

ページを再読み込みし、同じwalletへ再接続した後も、保存済みdepositが残高2.00 USDC・
`Ready to chat`・未解決支払いなしで開いた。検証用会話を開き直し、応答と
`Settled · 0.00 USDC` が保持されていることも確認した。
[最終確認記録](evidence/payment-recovery-complete-20261024.json)に結果を保存した。

新しいレシートのゼロ値は、その精算時に観測されたprovider使用量を表す。
日次Activityの追加照会はHTTP 400で確認できず、独立した最終請求確認には使えない。
provider側の最終請求額までゼロと確定したとは扱わない。

## 調査初期の検証

- 型チェック成功。
- 関連ブラウザテスト8件成功。復旧処理が正常returnしても未解決状態が残る場合、
  解決した場合、再送・出金を自動実行しないことを確認。
- 通常版・旧SDK `.12` / `.3` 復旧版の本番ビルド成功。
- `git diff --check` 成功。
- 元のブラウザでは詳細表示の閲覧だけを行い、復旧・再送・署名・入出金は実行していない。
