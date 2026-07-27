import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProviderPacingPendingLaunchInput,
  ProviderPacingPendingLaunch,
  ProviderPacingPendingLaunchRepository,
  type ProviderPacingPendingLaunchRepositoryShape,
} from "../Services/ProviderPacingPendingLaunches.ts";

const makeProviderPacingPendingLaunchRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertPendingLaunch = SqlSchema.void({
    Request: ProviderPacingPendingLaunch,
    execute: (launch) =>
      sql`
        INSERT INTO provider_pacing_pending_launches (
          thread_id,
          source_event_id,
          source_sequence,
          provider_instance_id,
          dispatch_source,
          requested_at
        )
        VALUES (
          ${launch.threadId},
          ${launch.sourceEventId},
          ${launch.sourceSequence},
          ${launch.providerInstanceId},
          ${launch.dispatchSource},
          ${launch.requestedAt}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          source_event_id = excluded.source_event_id,
          source_sequence = excluded.source_sequence,
          provider_instance_id = excluded.provider_instance_id,
          dispatch_source = excluded.dispatch_source,
          requested_at = excluded.requested_at
      `,
  });

  const getPendingLaunch = SqlSchema.findOneOption({
    Request: GetProviderPacingPendingLaunchInput,
    Result: ProviderPacingPendingLaunch,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          source_event_id AS "sourceEventId",
          source_sequence AS "sourceSequence",
          provider_instance_id AS "providerInstanceId",
          dispatch_source AS "dispatchSource",
          requested_at AS "requestedAt"
        FROM provider_pacing_pending_launches
        WHERE thread_id = ${threadId}
      `,
  });

  const listPendingLaunches = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProviderPacingPendingLaunch,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          source_event_id AS "sourceEventId",
          source_sequence AS "sourceSequence",
          provider_instance_id AS "providerInstanceId",
          dispatch_source AS "dispatchSource",
          requested_at AS "requestedAt"
        FROM provider_pacing_pending_launches
        ORDER BY requested_at ASC, thread_id ASC
      `,
  });

  const deletePendingLaunch = SqlSchema.void({
    Request: GetProviderPacingPendingLaunchInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM provider_pacing_pending_launches
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProviderPacingPendingLaunchRepositoryShape["upsert"] = (launch) =>
    upsertPendingLaunch(launch).pipe(
      Effect.mapError(toPersistenceSqlError("ProviderPacingPendingLaunchRepository.upsert:query")),
    );
  const getByThreadId: ProviderPacingPendingLaunchRepositoryShape["getByThreadId"] = (input) =>
    getPendingLaunch(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProviderPacingPendingLaunchRepository.getByThreadId:query"),
      ),
    );
  const listAll: ProviderPacingPendingLaunchRepositoryShape["listAll"] = listPendingLaunches(
    undefined,
  ).pipe(
    Effect.mapError(toPersistenceSqlError("ProviderPacingPendingLaunchRepository.listAll:query")),
  );
  const deleteByThreadId: ProviderPacingPendingLaunchRepositoryShape["deleteByThreadId"] = (
    input,
  ) =>
    deletePendingLaunch(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProviderPacingPendingLaunchRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    getByThreadId,
    listAll,
    deleteByThreadId,
  } satisfies ProviderPacingPendingLaunchRepositoryShape;
});

export const ProviderPacingPendingLaunchRepositoryLive = Layer.effect(
  ProviderPacingPendingLaunchRepository,
  makeProviderPacingPendingLaunchRepository,
);
