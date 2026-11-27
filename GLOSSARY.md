# Slidekit

Slidekit builds and deploys slideshows that viewers watch live, with each viewer's screen following the presenter. See [`docs/design.md`](docs/design.md) for the design.

## Content

**Deck**:
One slideshow: an ordered list of slides plus its config and theme. One deck deploys as one Worker.
_Avoid_: Presentation, slideshow, talk (in code)

**Slide**:
One screen of a deck, written as a view of its current step.
_Avoid_: Page, card

**Step**:
One stop inside a slide, counted from 0. A slide with `steps: 3` has steps 0, 1, and 2.
_Avoid_: Fragment, build, click

**Position**:
The pair `{ slide, step }` that says what is on screen. The position is the only state that sync carries.
_Avoid_: Location, cursor, index

**Notes**:
The speaker notes of a slide, shown only in the presenter view.
_Avoid_: Speaker notes (in code), comments

**Canvas**:
The fixed logical surface a slide renders on, 1920×1080 by default, scaled to fit the window.
_Avoid_: Viewport, stage

**Chrome**:
Everything slidekit draws around the canvas: the frame, the progress bar, the dots, the counters, and the controls.
_Avoid_: UI, toolbar, controls (for the whole set)

**Theme**:
The tokens a deck may change: colours, fonts, and radius.
_Avoid_: Skin, style

## Sync

**Room**:
The Durable Object that holds a deck's live session: its sockets and the last position.
_Avoid_: Session, channel, hub

**Presenter**:
A client authenticated with the presenter code. A presenter's moves change the room's position.
_Avoid_: Host, speaker, admin

**Viewer**:
A client that is not a presenter.
_Avoid_: Audience member, attendee, guest

**Live**:
True while a presenter socket is connected, and for a 10-second grace period after the last one closes.
_Avoid_: Online, active

**Following**:
The viewer mode in which the viewer's position tracks the presenter's.
_Avoid_: Synced, locked

**Detached**:
The viewer mode a viewer enters by navigating on its own while the presenter is live.
_Avoid_: Unsynced, free mode

**Presenter code**:
The secret a presenter enters at `/present`. The Worker stores only its hash.
_Avoid_: Password, PIN, token

**Presenter session**:
One signed-in presenter device, held as a signed cookie for 12 hours. A new presenter code ends every presenter session.
_Avoid_: Login (for the state), token (for the concept)

**Build id**:
The id of one deployed bundle. A client whose build id differs from the room's reloads.
_Avoid_: Version, hash

## Deploy

**Stage**:
One deploy of a deck, with its own Worker, room and presenter code. `production` is the default stage and deploys as the deck's own Worker. `dev` is the local stage of `slidekit dev`.
_Avoid_: Environment, deployment (for the name)
