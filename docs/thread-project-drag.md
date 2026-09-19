# Move a thread by dragging

Drag a thread row onto another project header in the sidebar. Release when the
header highlights and shows **Release to move thread**. The destination opens
after the move succeeds. The conversation keeps its thread identity and history.

This works with manual and automatic project sorting, including collapsed
destinations. It moves one thread at a time, even if several rows are selected.
The existing **Move Thread** context-menu action remains available for keyboard
and touch use. Escape, leaving the application, or ending the drag cancels it.

Both projects must belong to the same connected server. A grouped header must
identify exactly one destination on that server. For an ambiguous group, use
**Move Thread** to choose the exact project. Drops from other windows or external
applications are not accepted.

The move uses the existing `thread.meta.update` command and clears the old
worktree override. It does not copy project files or change a running command's
working directory. Failed requests leave the sidebar's authoritative thread data
unchanged. The connection, source project, destination, and archive state are
checked again at the time of the drop.

Drop feedback uses the sidebar's existing spacing, rounded corners, and accent
tokens. Readable bilingual labels and stable row sizing take priority over forcing
an exact silver ratio on the small drop indicator.

## 日本語

サイドバーのスレッドを別のプロジェクト名へドラッグしてください。
**離すとスレッドを移動します**と表示された場所で離すと、スレッドが移動します。
移動先は自動で開き、会話の履歴は保持されます。手動・自動の並べ替えに対応しています。
移動できるのは同じ接続先サーバー内のプロジェクトです。
移動先が複数あるグループでは、メニューの**Move Thread**から選択してください。
ファイルのコピーや、実行中のコマンドの作業ディレクトリ変更は行いません。

## Synthetic preview

The preview uses fixture data and the production drag controls. No user thread
was moved during testing.

![Bilingual drop feedback](pr-assets/thread-project-drag/dual-drop.png)
