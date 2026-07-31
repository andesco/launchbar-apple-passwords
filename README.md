# Apple Passwords LaunchBar Action

A LaunchBar action that finds Apple Passwords entries for a domain using
[`apw`](https://github.com/bendews/apw).

## Requirements

- macOS 14 or newer
- LaunchBar 6
- APW 1.1.0 or newer
- One of APW's supported Chromium-based browsers with Apple's iCloud Passwords
  extension installed

Install and start APW:

```sh
brew install bendews/homebrew-tap/apw
brew services start apw
```

APW must be authenticated again whenever its daemon restarts. When that is
needed, the action automatically requests an Apple Passwords verification code.
LaunchBar then shows **Enter verification code** as an action
result. Press Return to open its fresh six-digit code field, enter the code shown
by macOS, and press Return again. Password and one-time-code pastes resume
automatically. If LaunchBar does not restore a domain lookup’s result list, run
that domain lookup again. Terminal is not required.

## Install the action

### From a release

Download `Apple-Passwords-vX.Y.Z.lbaction.zip` from the repository's
[GitHub Releases](https://github.com/andesco/launchbar-apple-passwords/releases)
page. Unzip it if your browser does not do so automatically, then double-click
both `Apple Passwords.lbaction` and `Enter verification code.lbaction`, confirming each
installation in LaunchBar.

### From source

Clone or download the repository, then double-click
`Apple Passwords.lbaction` and `Enter verification code.lbaction`. The bundles contain the
JavaScript source that LaunchBar runs, so there is nothing to compile.

To review, test, and package the source yourself:

```sh
bun run test
bun run build
```

The build command validates and tests the action, then creates a versioned
release ZIP in `dist/`. The ZIP is only a download convenience; LaunchBar
installs the `.lbaction` bundle inside it.

## Use

1. Select **Apple Passwords** in LaunchBar.
2. Press Space, type a domain such as `example.com`, and press Return.
3. If APW finds multiple accounts, choose one. Exact-domain matches are listed
   first, followed by subdomains and parent-domain matches. A single match opens
   its fields immediately.
4. Choose **Username**, **Password**, or **One-time code** to paste it into the
   previously active application.

The action never enumerates the whole password store. It sends only the domain
you typed to APW. Passwords and one-time codes are fetched only after you choose
the corresponding field.

### Partial matching

APW's helper can look up a complete domain or hostname, but it cannot enumerate
all saved sites or search arbitrary partial text. This action therefore maintains
a local, non-secret metadata index of the results from successful complete-domain
lookups. After looking up `redflagdeals.com`, for example, a later search for
`redflag` can match that domain and any returned subdomains.

The index contains domains, usernames, titles, and availability flags, but never
passwords or one-time codes. It is stored in LaunchBar's Action Support folder.
Partial search can only find entries learned through previous complete-domain
lookups; it is not yet a complete-vault search.

## Clipboard history

The action leverages LaunchBar's paste functionality to paste passwords and
one-time codes without adding them to clipboard history (including LaunchBar
itself and macOS Spotlight).

## APW executable locations

The action looks for APW in:

- `/opt/homebrew/bin/apw`
- `/usr/local/bin/apw`
- `/opt/local/bin/apw`
- the executable returned by `/usr/bin/which apw`

## Development and releases

Source files, including `Apple Passwords.lbaction`, are committed to Git.
Generated ZIP files are ignored and attached to GitHub Releases instead.

Build a ZIP for the current version:

```sh
bun run build
```

Prepare a new version locally:

```sh
bun run release -- 0.3.0
```

The release command:

1. Updates the version in `package.json` and both LaunchBar bundles.
2. Validates, tests, and packages the action.
3. Commits the version change and creates the corresponding Git tag.

It does not connect to GitHub. This provides an opportunity to review the commit,
tag, and ZIP before publication.

Publish the prepared version:

```sh
bun run publish -- 0.3.0
```

The publish command requires an authenticated
[GitHub CLI](https://cli.github.com/). It verifies the prepared version and tag,
rebuilds and tests the ZIP, pushes the branch and tag to the existing `origin`
remote, and creates or updates the GitHub Release.

The working tree must be clean before running `release` or `publish`. `build`
never commits, tags, pushes, or uploads anything.
