import { Command, UiSchema, Validation } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Effect, Option, Redacted, Schema } from "effect"
import * as Code from "../auth/Code.ts"

/** The status the Worker answers `path` with, or `null` when it can't be reached. The session cookie rides along. */
export const requestStatus = (path: string, init?: RequestInit): Effect.Effect<number | null> =>
  Effect.tryPromise((signal) => fetch(path, { ...init, signal })).pipe(
    Effect.map((response) => response.status),
    Effect.orElseSucceed(() => null)
  )

export const LoginValidation = Validation.make({
  code: {
    value: Schema.Redacted(Schema.String),
    required: "Enter the presenter code.",
    rules: [[
      (code) => Option.isSome(Code.normalize(Redacted.value(code))),
      "A presenter code is 8 letters and digits, like ABCD-EFGH."
    ]]
  }
})

export const SignInFailure = Schema.Literals(["WrongCode", "TooManyAttempts", "Unreachable"])
export type SignInFailure = typeof SignInFailure.Type

/** What each failure tells the presenter. A locked-out deck reads differently from a wrong code. */
export const failureMessage: Readonly<Record<SignInFailure, string>> = {
  WrongCode: "That code isn't right.",
  TooManyAttempts: "Too many wrong codes for this deck. Wait 10 minutes, then try again.",
  Unreachable: "Couldn't reach the deck. Check the connection and try again."
}

export const PresenterLoginProps = Schema.Struct({ title: Schema.String })

export const PresenterLoginModel = Schema.Struct({ form: LoginValidation.State, submitting: Schema.Boolean })

export const PresenterLoginMessage = UiSchema.TaggedEnum({
  UpdatedCode: { value: Schema.Redacted(Schema.String) },
  SubmittedForm: {},
  SucceededSignIn: {},
  FailedSignIn: { reason: SignInFailure }
})

export const PresenterLoginEvents = UiSchema.TaggedEnum({ SignedIn: {} })

/** Posts the code to `/present/login`. The Worker answers 204 with the session cookie, 401, or 429 when locked out. */
export class SignIn extends Command.Service<SignIn>()("slidekit/SignIn", {
  args: { code: Schema.Redacted(Schema.String) },
  success: PresenterLoginMessage
}) {
  static readonly layer = this.toLayer(Effect.succeed(({ code }) =>
    requestStatus("/present/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: Redacted.value(code) })
    }).pipe(Effect.map((status) => {
      switch (status) {
        case 204:
          return PresenterLoginMessage.SucceededSignIn()
        case 401:
          return PresenterLoginMessage.FailedSignIn({ reason: "WrongCode" })
        case 429:
          return PresenterLoginMessage.FailedSignIn({ reason: "TooManyAttempts" })
        default:
          return PresenterLoginMessage.FailedSignIn({ reason: "Unreachable" })
      }
    }))
  ))
}

export const validateLogin = (form: typeof LoginValidation.State.Type) => LoginValidation.validate(form)

/** The presenter code form. It is a leaf, because a `Redacted` keeps its whole state out of history. */
export const PresenterLogin = Html.component({
  name: "PresenterLogin",
  props: PresenterLoginProps,
  model: PresenterLoginModel,
  message: PresenterLoginMessage,
  events: PresenterLoginEvents
}).make({
  init: () => ({ form: LoginValidation.init({ code: Redacted.make("") }), submitting: false }),

  update: {
    UpdatedCode: ($, { value }) =>
      $.model.submitting ? $.model : $.evolve({ form: (form) => LoginValidation.change(form, "code", value) }),
    SubmittedForm: ($) => {
      const form = LoginValidation.submit($.model.form)
      return Option.match(validateLogin(form).value, {
        onNone: () => $.evolve({ form }),
        onSome: ({ code }) => $.model.submitting ? $.model : $.set({ form, submitting: true }).run(SignIn.make({ code }))
      })
    },
    SucceededSignIn: ($) => $.evolve({ submitting: false }).emit(PresenterLoginEvents.SignedIn()),
    FailedSignIn: ($, { reason }) => ({
      submitting: false,
      form: LoginValidation.reject($.model.form, { code: [failureMessage[reason]] })
    })
  },

  view: (h, model) => {
    const { code } = validateLogin(model.form).fields
    return h.div.class("fixed inset-0 grid place-items-center overflow-auto bg-paper px-4 font-sans text-ink").children(
      h.form
        .class("w-full max-w-sm rounded-frame bg-cream p-8 shadow-[0_1px_2px_rgb(59_26_12/0.06)] ring-1 ring-line")
        .attr("novalidate", "")
        .on("submit", PresenterLoginMessage.SubmittedForm())
        .children(
          h.p.class("font-mono text-[11px] font-medium tracking-[0.2em] text-accent uppercase").children("Presenter"),
          h.h1.class("mt-3 text-2xl leading-tight font-semibold tracking-tight").children(h.props.title),
          h.p.class("mt-2 text-sm text-ink/60").children("Enter the presenter code to control the deck."),
          h.label.class("mt-8 block font-mono text-[11px] tracking-wider text-ink/60 uppercase").children(
            "Presenter code",
            h.input
              .class(
                "mt-2 block w-full rounded-frame bg-paper px-3 py-2.5 font-mono text-lg tracking-[0.2em] text-ink uppercase ring-1 ring-line outline-none placeholder:text-ink/25 focus:ring-2 focus:ring-accent aria-invalid:ring-accent"
              )
              .attrs({
                type: "password",
                name: "code",
                placeholder: "XXXX-XXXX",
                autocomplete: "current-password",
                autocapitalize: "characters",
                spellcheck: "false",
                "aria-invalid": code._tag === "Invalid" ? "true" : undefined,
                "aria-describedby": code._tag === "Invalid" ? "code-error" : undefined
              })
              .value(Redacted.value(code.value))
              .disabled(model.submitting)
              .on("input", ({ value }) => PresenterLoginMessage.UpdatedCode({ value: Redacted.make(value) }))
          ),
          code._tag === "Invalid"
            ? h.p.class("mt-3 text-sm text-accent").attr("id", "code-error").attr("role", "alert").children(code.errors[0])
            : null,
          h.button
            .class(
              "mt-6 w-full rounded-frame bg-accent px-4 py-2.5 text-sm font-semibold text-cream shadow-sm transition-colors hover:bg-ink disabled:opacity-60"
            )
            .attr("type", "submit")
            .disabled(model.submitting)
            .children(model.submitting ? "Checking…" : "Sign in")
        )
    )
  }
})
