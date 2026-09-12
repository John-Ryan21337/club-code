# Check Claude access

Saved credentials can expire before a long run starts. Use a small live check to
confirm that the selected Claude connection and model accept a request.
The request can consume a small amount of provider usage.

1. Open **Settings > Providers**.
2. Open the settings for the Claude connection you will use.
3. Under **Check access before a long run**, select the model.
4. Select **Check access** and read the result and check time.

The check uses the saved provider instance, its managed runtime, and its
authentication environment. It sends synthetic text from an empty temporary
directory with tools, hooks, plugins, and session persistence disabled. It does
not resume or interrupt a chat. Project settings can still change an actual task.

The result clears when the displayed settings or selected model change.
Checks wait for settings to finish saving and reject a mismatch with saved
provider settings. Each instance permits one check at a time and waits one minute
between checks. The request has a 30-second deadline and a small output budget.

| Status                  | Meaning                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| verified                | A live request succeeded at the recorded time.                          |
| authentication-required | Sign in through the provider's normal login flow, then check again.     |
| account-restricted      | The account cannot use the requested model.                             |
| rate-limited            | The failed request reported a usage limit.                              |
| unverified              | Access was not proved. Check the connection, saved settings, and model. |
| unsupported             | This provider does not support the check.                               |
| busy                    | A check is running or the delay between checks has not elapsed.         |

This action supports Claude connections only. It does not check an external CLI
found on the shell's PATH. It runs only when selected; ordinary turns do not
trigger an extra request. A successful check does not guarantee access or quota
for the full task. Raw provider responses and credential values are not displayed.
