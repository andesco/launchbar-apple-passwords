"use strict";

var ACTION_BUNDLE_IDENTIFIER =
  "ca.andrewlaunchbar.action.apple-passwords-pin";

function run(argument) {
  var code = String(argument || "").trim();
  if (!/^\d{6}$/.test(code)) {
    clearInputHistory();
    clearInputHistoryLater();
    return [
      {
        title: "Invalid verification code",
        subtitle: "Enter the complete six-digit code shown by macOS.",
      },
    ];
  }

  clearInputHistory();
  LaunchBar.performAction(
    "Apple Passwords",
    "__apple_passwords_auth_response__:" + code
  );
  clearInputHistoryLater();
}

function clearInputHistory() {
  try {
    LaunchBar.execute(
      "/usr/bin/defaults",
      "write",
      "at.obdev.LaunchBar",
      "TextInputHistory",
      "-dict-add",
      ACTION_BUNDLE_IDENTIFIER,
      ""
    );
  } catch (error) {
    LaunchBar.log(
      "Could not clear verification-code input history: " + error.message
    );
  }
}

function clearInputHistoryLater() {
  try {
    LaunchBar.execute(
      "/bin/sh",
      "-c",
      '(sleep 0.25; /usr/bin/defaults write "$@" >/dev/null 2>&1) &',
      "clear-verification-history",
      "at.obdev.LaunchBar",
      "TextInputHistory",
      "-dict-add",
      ACTION_BUNDLE_IDENTIFIER,
      ""
    );
  } catch (error) {
    LaunchBar.log(
      "Could not schedule verification-code input history cleanup: " +
        error.message
    );
  }
}
