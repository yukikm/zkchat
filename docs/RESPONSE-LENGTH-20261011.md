# 回答が途中で終了する問題の修正

2026-10-11。公開Devnetの回答上限を128から4,096 output tokensへ変更しました。

## 原因と修正

アプリは公開profileを使う送信を128 tokensに固定し、SDK呼び出し前にも129以上を拒否していました。また、SDKの本文ヘルパーは`finish_reason: "length"`も正常な受信完了として扱うため、画面に打ち切りの理由が出ませんでした。`Payment not yet verified`は別の精算状態表示です。

- 現行版の設定・送信・送信前チェックを4,096まで対応。新規設定の初期値も4,096。保存済みの有効な設定値は保持します。
- JSON/SSEの終了理由を本文と一緒に保存し、長さ制限・providerのcontent filterを画面で説明します。再読み込み後も案内を保持します。
- 公開SDKを引き続き応答検証に使い、SSE終端後のHTTP EOF待機・エラー・停止伝播を維持します。本文を複製して別に読み取ることはありません。
- 上限に達した回答も同じ会話の文脈に残し、利用者が「続けて」と明示送信できます。自動継続や再送はしません。
- `.3`復旧版は元の128-token上限を維持します。認証済みprofile、SDK archive、保存名、note、資金の認証上限は変更していません。

`solana-zkapi`リポジトリの現行Devnet・SDK・clientd・OpenClawガイドとsupport表も4,096へ更新し、[仕様書の変更](https://github.com/yukikm/solana-zkapi/commit/d3939d05710c2aefa9b316f7a3b44565816f4ccc)を公開しました。この上限はアプリの利用仕様であり、認証済みprofileのフィールドやdirect backendのtoken強制上限ではありません。

## 検証と公開

- Node 24.19.0で単体213件、オフライン画面55件が成功（公開ネットワーク用3件はスキップ）。最後の案内文調整後も関連画面7件が成功しました。
- 日本語の長文の末尾表示・保存・全文コピー、JSON/SSEでの長さ制限、設定値4,096/2,048の実リクエストへの伝播をfixtureで確認しました。
- 本体・復旧版ビルド、`check-build`、`check:aws`、SDK archive検査が成功しました。
- 既存の`zkchat-static` / CloudFront `E3OT9UOJBXFFK5`へ272ファイル（13,041,808 bytes）を反映しました。invalidation `IBNVENX5B0AW9K23UZAEHL5DUM`は完了しています。
- [公開反映検証](evidence/deployment-response-length-20261011.json)：18ファイルのSHA-256・MIME・cache、配信ルート6項目、旧asset10件の保持、隔離ブラウザでのデモ・同一origin復旧が成功しました。

この修正を`v0.1.1`のソース・静的配信archiveとしてリリースします。配布物には本体と`recovery-v3/`、ライセンス一覧、固定済み公開設定を含み、release manifestとSHA-256一覧を添付します。

実providerへの4,096-token推論は実行していません。利用者の実ブラウザ保存領域・ウォレット・入出金は操作していません。既存の途中回答は自動復元されないため、公開画面を再読み込みし、必要なら`Appearance and chat`の`Response length`を4,096に変更して同じ会話で続きを依頼してください。
