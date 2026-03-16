import { Database } from "bun:sqlite"
import { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint"
import type {
  Checkpoint,
  CheckpointListOptions,
  CheckpointMetadata,
  CheckpointTuple,
  PendingWrite,
} from "@langchain/langgraph-checkpoint"
import type { RunnableConfig } from "@langchain/core/runnables"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

const WRITES_IDX_MAP: Record<string, number> = {
  __error__: -1,
  __scheduled__: -2,
  __interrupt__: -3,
  __resume__: -4,
}

export class BunSqliteSaver extends BaseCheckpointSaver {
  private db: Database

  constructor(path = "./data/checkpoints.sqlite") {
    super()
    mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    this.db.exec("PRAGMA journal_mode=WAL")
    this.db.exec("PRAGMA synchronous=NORMAL")
    this.setup()
  }

  private setup() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        type TEXT NOT NULL,
        checkpoint BLOB NOT NULL,
        metadata TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        write_idx INTEGER NOT NULL,
        channel TEXT NOT NULL,
        type TEXT NOT NULL,
        value BLOB NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx)
      )
    `)
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id ?? ""
    const checkpointNs = config.configurable?.checkpoint_ns ?? ""
    const checkpointId = config.configurable?.checkpoint_id

    let row: any

    if (checkpointId) {
      row = this.db
        .query(
          `SELECT checkpoint_id, type, checkpoint, metadata, parent_checkpoint_id
           FROM checkpoints
           WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
        )
        .get(threadId, checkpointNs, checkpointId)
    } else {
      row = this.db
        .query(
          `SELECT checkpoint_id, type, checkpoint, metadata, parent_checkpoint_id
           FROM checkpoints
           WHERE thread_id = ? AND checkpoint_ns = ?
           ORDER BY checkpoint_id DESC LIMIT 1`,
        )
        .get(threadId, checkpointNs)
    }

    if (!row) return undefined

    const checkpoint = (await this.serde.loadsTyped(
      row.type,
      typeof row.checkpoint === "string" ? row.checkpoint : new Uint8Array(row.checkpoint),
    )) as Checkpoint

    const metadata = JSON.parse(row.metadata) as CheckpointMetadata

    // Load pending writes
    const writeRows: any[] = this.db
      .query(
        `SELECT task_id, channel, type, value
         FROM writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
         ORDER BY write_idx`,
      )
      .all(threadId, checkpointNs, row.checkpoint_id)

    const pendingWrites: [string, string, unknown][] = []
    for (const w of writeRows) {
      const value = await this.serde.loadsTyped(
        w.type,
        typeof w.value === "string" ? w.value : new Uint8Array(w.value),
      )
      pendingWrites.push([w.task_id, w.channel, value])
    }

    const resultConfig: RunnableConfig = {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: row.checkpoint_id,
      },
    }

    const parentConfig = row.parent_checkpoint_id
      ? {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            checkpoint_id: row.parent_checkpoint_id,
          },
        }
      : undefined

    return {
      config: resultConfig,
      checkpoint,
      metadata,
      parentConfig,
      pendingWrites,
    }
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id ?? ""
    const checkpointNs = config.configurable?.checkpoint_ns ?? ""
    const limit = options?.limit
    const before = options?.before?.configurable?.checkpoint_id

    let sql = `SELECT checkpoint_id, type, checkpoint, metadata, parent_checkpoint_id
               FROM checkpoints
               WHERE thread_id = ? AND checkpoint_ns = ?`
    const params: any[] = [threadId, checkpointNs]

    if (before) {
      sql += ` AND checkpoint_id < ?`
      params.push(before)
    }

    sql += ` ORDER BY checkpoint_id DESC`

    if (limit) {
      sql += ` LIMIT ?`
      params.push(limit)
    }

    const rows: any[] = this.db.query(sql).all(...params)

    for (const row of rows) {
      // Apply metadata filter if provided
      if (options?.filter) {
        const metadata = JSON.parse(row.metadata)
        const matches = Object.entries(options.filter).every(
          ([k, v]) => metadata[k] === v,
        )
        if (!matches) continue
      }

      const checkpoint = (await this.serde.loadsTyped(
        row.type,
        typeof row.checkpoint === "string" ? row.checkpoint : new Uint8Array(row.checkpoint),
      )) as Checkpoint

      const metadata = JSON.parse(row.metadata) as CheckpointMetadata

      const resultConfig: RunnableConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: row.checkpoint_id,
        },
      }

      const parentConfig = row.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: threadId,
              checkpoint_ns: checkpointNs,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
        : undefined

      yield {
        config: resultConfig,
        checkpoint,
        metadata,
        parentConfig,
      }
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id ?? ""
    const checkpointNs = config.configurable?.checkpoint_ns ?? ""
    const parentCheckpointId = config.configurable?.checkpoint_id

    const [type, data] = await this.serde.dumpsTyped(checkpoint)

    this.db
      .query(
        `INSERT OR REPLACE INTO checkpoints
         (thread_id, checkpoint_ns, checkpoint_id, type, checkpoint, metadata, parent_checkpoint_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        threadId,
        checkpointNs,
        checkpoint.id,
        type,
        data,
        JSON.stringify(metadata),
        parentCheckpointId ?? null,
      )

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    }
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const threadId = config.configurable?.thread_id ?? ""
    const checkpointNs = config.configurable?.checkpoint_ns ?? ""
    const checkpointId = config.configurable?.checkpoint_id ?? ""

    const stmt = this.db.query(
      `INSERT OR REPLACE INTO writes
       (thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx, channel, type, value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )

    for (let i = 0; i < writes.length; i++) {
      const [channel, value] = writes[i]
      const writeIdx = WRITES_IDX_MAP[channel as string] ?? i
      const [type, data] = await this.serde.dumpsTyped(value)
      stmt.run(
        threadId,
        checkpointNs,
        checkpointId,
        taskId,
        writeIdx,
        channel as string,
        type,
        data,
      )
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    this.db
      .query(`DELETE FROM writes WHERE thread_id = ?`)
      .run(threadId)
    this.db
      .query(`DELETE FROM checkpoints WHERE thread_id = ?`)
      .run(threadId)
  }

  close() {
    this.db.close()
  }
}
