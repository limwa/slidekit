import { describe, expect, it } from "@effect/vitest"
import * as Project from "./project.ts"

describe("Worker names", () => {
  it("derives a Worker name from a package name", () => {
    expect(Project.workerName("@me/My Talk")).toBe("my-talk")
    expect(Project.workerName("talk_2026!")).toBe("talk-2026")
    expect(Project.workerName("---")).toBe("slidekit")
    expect(Project.workerName("a".repeat(80))).toHaveLength(63)
  })

  it("accepts only lowercase letters, digits and inner dashes, up to 63", () => {
    for (const name of ["demo", "my-talk", "a", "x1", "a".repeat(63)]) expect(Project.isWorkerName(name)).toBe(true)
    for (const name of ["", "Demo", "my_talk", "-demo", "demo-", "my talk", "a".repeat(64)]) {
      expect(Project.isWorkerName(name)).toBe(false)
    }
  })

  it("keeps the deck's name for the default stage and suffixes every other", () => {
    expect(Project.stageWorkerName("demo", Project.defaultStage)).toBe("demo")
    expect(Project.stageWorkerName("demo", "preview")).toBe("demo-preview")
  })
})
