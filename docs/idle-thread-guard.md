# Idle Thread Guard

Idle Thread Guard sends a short status request when a running turn has had no recorded thread or session activity for a set number of hours. It is off by default. Expand **Idle Thread Guard** above the composer, set whole hours from 1 to 720, edit the request if needed, and enable it for the selected thread. The default is two hours. Requests use the selected thread's existing provider and can consume paid tokens.

Settings belong to the exact environment and thread in this browser profile. They do not sync to other devices. The coordinator runs while Cafe is open and authenticated. A suspended or closed app does not provide a background timer. A check occurs about once per minute; it is not an exact alarm.

The Guard requires a running session and turn. It waits while an approval, user-input request, actionable plan, pending or claimed follow-up, thread error, or unreadable follow-up queue is present. New thread or session activity restarts the idle period. The Guard uses Cafe's existing steer command and does not create a new turn or change provider permissions.

Before a request, the Guard saves a claim under a browser lock. Other windows on the same origin share that claim. After the server acknowledges the command, the Guard waits for activity newer than the acknowledgement, then another full idle period. The acknowledgement confirms command acceptance; it does not prove that the provider has answered. If the result is unknown, or the window closes before acknowledgement, the claim remains paused. Review the thread, then save the Guard settings again to permit a new attempt. An old acknowledgement cannot settle a newer claim.

The control requires browser locks, secure random IDs, and writable local storage. If these are unavailable, it cannot enable or send requests. An explicit resave resets the claim; it does not cancel an already submitted request. Use longer intervals for tasks that work silently for hours.

The Guard checks the saved claim and current thread eligibility again immediately before submission. If the coordinator closes or the thread becomes ineligible before submission, it cancels the unsent claim and requires a fresh idle period. Disabling or resaving the settings invalidates an older unsent claim.

English, Japanese, and bilingual built-in prompts follow the interface language when you edit the control. Custom text stays unchanged. A language change does not silently rewrite an already saved request; save the settings to apply the new built-in prompt.

## 日本語

Idle Thread Guard は、実行中のターンに設定時間以上スレッドやセッションの動作が記録されていない場合、短い状況確認を送信します。初期状態はオフです。入力欄の上の **アイドルスレッドガード** を開き、1～720の整数で時間を設定し、必要ならメッセージを編集して、そのスレッドで有効にしてください。初期値は2時間です。リクエストは既存のプロバイダーを使い、有料トークンを消費する場合があります。

設定は、このブラウザープロファイル内の環境とスレッドの組み合わせに保存されます。他の端末には同期されません。Cafe を開いて認証されている間に動作します。アプリが停止中または閉じている間のバックグラウンドタイマーではありません。確認は約1分ごとで、正確な時刻を保証するアラームではありません。

セッションとターンが実行中の場合だけ動作します。承認、ユーザー入力、操作が必要なプラン、待機中または処理権を取得済みのフォローアップ、スレッドエラーがある場合や、フォローアップキューを読み取れない場合は送信しません。新しい動作があると待機時間を数え直します。既存の steer コマンドを使い、新しいターンの開始やプロバイダーの権限変更は行いません。

送信前にブラウザーロックを使って送信権を保存し、同じオリジンの別ウィンドウとの重複送信を防ぎます。サーバーがコマンドを受領した後は、それより新しい動作と次の待機時間が過ぎるまで待ちます。受領確認は、プロバイダーが回答したことを意味しません。結果が不明な場合や、受領確認の前にウィンドウを閉じた場合は一時停止します。スレッドを確認し、設定を保存し直すと再試行できます。古い受領確認が新しい送信権を変更することはありません。

ブラウザーロック、安全なランダムID、書き込み可能なローカルストレージが必要です。利用できない場合は有効化や送信を行いません。保存し直すと送信権をリセットしますが、送信済みのリクエストは取り消しません。長時間無言で処理する作業には、長めの間隔を設定してください。

送信直前に、保存された送信権とスレッドの動作条件を再確認します。送信前に監視画面が閉じたり、スレッドが動作条件を満たさなくなったりした場合は、未送信の送信権を取り消し、待機時間を数え直します。設定を無効にしたり保存し直したりすると、古い未送信の送信権は無効になります。

英語、日本語、併記の定型文は、操作画面を編集するときに表示言語に合わせて変わります。独自の文章は変更しません。保存済みリクエストは表示言語の変更だけでは書き換えません。新しい定型文を適用するには、設定を保存してください。
