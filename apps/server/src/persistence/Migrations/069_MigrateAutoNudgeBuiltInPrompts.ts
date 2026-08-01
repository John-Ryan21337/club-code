import {
  AUTO_NUDGE_BUILT_IN_PROMPTS,
  LEGACY_AUTO_NUDGE_BUILT_IN_PROMPTS,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  for (const mode of ["hardcore-fanout", "steady-progress"] as const) {
    const currentPrompt = AUTO_NUDGE_BUILT_IN_PROMPTS[mode];
    for (const legacyPrompt of LEGACY_AUTO_NUDGE_BUILT_IN_PROMPTS[mode]) {
      yield* sql`
        UPDATE projection_threads
        SET auto_nudge_json = json_set(auto_nudge_json, '$.prompt', ${currentPrompt})
        WHERE json_valid(auto_nudge_json)
          AND json_extract(auto_nudge_json, '$.prompt') = ${legacyPrompt}
      `;
    }
  }
});
