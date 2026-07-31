# Apple Passwords LaunchBar Action

A LaunchBar action that finds Apple Passwords entries for a domain using
[`apw`](https://github.com/bendews/apw).

## Requirements

- macOS 14 or newer
- LaunchBar 6
- APW 1.1.0 or newer
- A supported [Chromium-based browser](https://github.com/bendews/apw#getting-started)
- Apple’s [iCloud Passwords extension](https://chromewebstore.google.com/detail/icloud-passwords/pejdijmoenmkgeppbflobdenhhabjlaj)

Install and start `apw`:

```sh
brew install bendews/homebrew-tap/apw
brew services start apw
```

## Install the action

[Download the latest release](https://github.com/andesco/launchbar-apple-passwords/releases/download/v0.5.0/Apple-Passwords-v0.5.0.lbaction.zip). Open both actions and confirm that each is installed in LaunchBar:

- `Apple Passwords.lbaction`
- `Enter verification code.lbaction`

## Use

1. Type `Apple Passwords` in LaunchBar and select it with <kbd>Return</kbd> or
   <kbd>Space</kbd>.
2. Type a domain such as `example.com` and press <kbd>Return</kbd>.
3. If APW finds multiple accounts, choose one. Exact-domain matches are listed
   first, followed by subdomains and parent-domain matches.
4. Choose **Username**, **Password**, or **One-time code** to paste it into the
   frontmost application.

If APW needs authentication while you use the action, LaunchBar shows **Enter
verification code** as an action result. Press <kbd>Return</kbd> to open its
fresh six-digit code field, enter the code shown by macOS, and press
<kbd>Return</kbd> again. Password and one-time-code pastes resume automatically.
If LaunchBar does not restore a domain lookup’s result list, run that domain
lookup again. Terminal is not required.

The action never enumerates the whole password store. It sends only the domain
you typed to APW. Passwords and one-time codes are fetched only after you choose
the corresponding field.

### Partial matching

APW can look up a complete domain or hostname, but it cannot enumerate
all saved sites or search arbitrary partial text. This action therefore maintains
a local, non-secret metadata index of the results from successful complete-domain
lookups. After looking up `example.com`, a later search for `examp`
can match that domain and any returned subdomains.

The index contains domains, usernames, titles, and availability flags, but never
passwords or one-time codes. It is stored in LaunchBar’s Action Support folder.
Partial search can only find entries learned through previous complete-domain
lookups; it is not yet a complete-vault search.

### Clipboard history

The action leverages LaunchBar’s paste functionality to paste passwords and
one-time codes without adding them to clipboard history (including LaunchBar
itself and macOS Spotlight).

## APW executable locations

The action looks for APW in:

- `/opt/homebrew/bin/apw`
- `/usr/local/bin/apw`
- `/opt/local/bin/apw`
- the executable returned by `/usr/bin/which apw`

## Development and releases

The tracked `.lbaction` bundles contain the JavaScript source that LaunchBar runs
and are intentionally committed to Git. Generated ZIP files are ignored and
attached to GitHub Releases instead.

**Build a ZIP for the current version:**

```sh
bun run build
```

**Prepare a new version locally:**

```sh
bun run release -- 0.0.0
```

The release command:

1. Updates the version in `package.json` and both LaunchBar bundles.
2. Validates, tests, and packages the action.
3. Commits the version change and creates the corresponding Git tag.

It does not connect to GitHub. This provides an opportunity to review the commit,
tag, and ZIP before publication.

**Publish the prepared version:**

```sh
bun run publish -- 0.0.0
```

The publish command requires an authenticated
[GitHub CLI](https://cli.github.com/). It verifies the prepared version and tag,
rebuilds and tests the ZIP, pushes the branch and tag to the existing `origin`
remote, and creates or updates the GitHub Release.

The working tree must be clean before running `release` or `publish`.
