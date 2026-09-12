# Interface language

Open **Settings → Appearance → Interface language**. Select **English**, **日本語**, **English + 日本語**, or **Follow system**.

The selection applies to this browser or desktop renderer. Another client connected to the same Cafe server keeps its own language. Follow system uses Japanese when the device's primary language starts with `ja`; otherwise it uses English.

Japanese mode translates supported interface labels. Bilingual mode shows `English / 日本語`. Labels without a catalog entry stay in English. Messages, code, terminal output, file contents, and provider-authored questions keep their original text. The selection does not change provider prompts or request a translation from a model.

The port translates explicitly authored React text and label attributes. React context also reaches menus and dialogs rendered in portals. It does not scan or rewrite the document. Use `UiText` or `t()` only with interface strings. Never pass user content to these functions or add it to the catalog.

## 日本語

**設定 → 外観 → インターフェース言語**を開き、**English**、**日本語**、**English + 日本語**、または**システム設定に従う**を選択します。

選択はこのブラウザーまたはデスクトップ画面だけに適用されます。同じ Cafe サーバーに接続している別の端末の言語は変更されません。システム設定に従う場合、端末の優先言語が `ja` で始まると日本語、それ以外は英語を使用します。

日本語モードでは、対応する画面のラベルを翻訳します。両言語モードでは `English / 日本語` と表示します。翻訳が登録されていないラベルは英語のままです。メッセージ、コード、端末出力、ファイル内容、プロバイダーが作成した質問は元の文章を維持します。言語を変更しても、プロバイダーへの指示を変更したり、モデルに翻訳を依頼したりしません。
