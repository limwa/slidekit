import { HtmlLocator, HtmlScene } from "@effect/ui/html/testing"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Redacted } from "effect"
import { failureMessage, PresenterLogin, PresenterLoginEvents, PresenterLoginMessage, SignIn } from "./PresenterLogin.ts"

const code = HtmlLocator.label("Presenter code")
const submit = HtmlLocator.role("button", { name: "Sign in" })
const alert = HtmlLocator.role("alert")

const signingIn = Effect.gen(function*() {
  const s = yield* HtmlScene.make(PresenterLogin, { title: "Test deck" })
  return s.type(code, "abcd efgh").click(submit).expectExact(SignIn.make({ code: Redacted.make("abcd efgh") }))
})

describe("PresenterLogin", () => {
  it.effect("shows that a code is wrong", () =>
    Effect.gen(function*() {
      const s = yield* signingIn
      s.expect(HtmlLocator.role("button", { name: "Checking…" })).toBeDisabled()
        .resolve(SignIn, PresenterLoginMessage.FailedSignIn({ reason: "WrongCode" }))
        .expect(alert).toHaveText(failureMessage.WrongCode)
        .expect(submit).toBeDisabled(false)
        // Editing the code clears the Worker's answer.
        .type(code, "abcd efgj")
        .expect(alert).toBeAbsent()
    }))

  it.effect("tells a locked-out deck apart from a wrong code", () =>
    Effect.gen(function*() {
      const s = yield* signingIn
      s.resolve(SignIn, PresenterLoginMessage.FailedSignIn({ reason: "TooManyAttempts" }))
        .expect(alert).toHaveText(failureMessage.TooManyAttempts)
      expect(failureMessage.TooManyAttempts).not.toBe(failureMessage.WrongCode)
    }))

  it.effect("tells its parent once the code is right", () =>
    Effect.gen(function*() {
      const s = yield* signingIn
      s.resolve(SignIn, PresenterLoginMessage.SucceededSignIn()).emitted(PresenterLoginEvents.SignedIn())
    }))

  it.effect("doesn't send what can't be a code", () =>
    Effect.gen(function*() {
      const s = yield* HtmlScene.make(PresenterLogin, { title: "Test deck" })
      s.click(submit).expectNone().expect(alert).toHaveText("Enter the presenter code.")
        .type(code, "abc").click(submit).expectNone()
        .expect(alert).toHaveText("A presenter code is 8 letters and digits, like ABCD-EFGH.")
    }))
})
