include("core.js");

var APW_PATHS = [
  "/opt/homebrew/bin/apw",
  "/usr/local/bin/apw",
  "/opt/local/bin/apw",
];
var APW_INVALID_SESSION = 9;
var AUTHENTICATION_TIMEOUT_MS = 2 * 60 * 1000;
var AUTHENTICATION_ACTION_BUNDLE =
  "ca.andrewlaunchbar.action.apple-passwords-pin";
var AUTHENTICATION_RESPONSE_PREFIX = "__apple_passwords_auth_response__:";

function run(argument) {
  var input = String(argument || "").trim();
  if (input.indexOf(AUTHENTICATION_RESPONSE_PREFIX) === 0) {
    return submitAuthenticationResponse(
      input.slice(AUTHENTICATION_RESPONSE_PREFIX.length)
    );
  }

  clearPendingAuthentication();
  return runLookup(input);
}

function suggest(argument) {
  var query;
  try {
    query = normalizeQuery(argument);
  } catch (error) {
    return [];
  }

  return domainSuggestionItems(filterIndex(readIndex(), query), query);
}

function domainSuggestionItems(records, query) {
  var suggestionsByDomain = {};

  (records || []).forEach(function (record) {
    uniqueDomains([record.domain].concat(record.sites || [])).forEach(
      function (domain) {
        if (domain.indexOf(query) === -1) return;
        if (!suggestionsByDomain[domain]) {
          suggestionsByDomain[domain] = { count: 0, labels: [] };
        }

        var suggestion = suggestionsByDomain[domain];
        var label = String(record.title || record.username || "").trim();
        suggestion.count += 1;
        if (label && suggestion.labels.indexOf(label) === -1) {
          suggestion.labels.push(label);
        }
      }
    );
  });

  return Object.keys(suggestionsByDomain)
    .sort(function (left, right) {
      var rankDifference =
        relationshipRank(left, query) - relationshipRank(right, query);
      return rankDifference || left.localeCompare(right);
    })
    .map(function (domain) {
      var suggestion = suggestionsByDomain[domain];
      var subtitle =
        suggestion.count === 1 && suggestion.labels.length
          ? suggestion.labels[0]
          : suggestion.count + " saved accounts";
      return {
        title: domain,
        subtitle: subtitle,
        icon: "com.apple.Passwords",
      };
    });
}

function runLookup(argument) {
  var query;
  try {
    query = normalizeQuery(argument);
  } catch (error) {
    return [messageItem("Invalid search", error.message)];
  }

  if (!isCompleteDomain(query)) {
    var indexedMatches = filterIndex(readIndex(), query);
    if (!indexedMatches.length) {
      return [
        messageItem(
          "No indexed matches",
          "APW cannot enumerate the vault. Search complete domains first to add their matches to this action’s local metadata index."
        ),
      ];
    }

    var indexedAuthentication = authenticateBeforeIndexedResults(
      indexedMatches,
      query
    );
    if (indexedAuthentication) return indexedAuthentication;

    return resultsForRecords(indexedMatches);
  }

  var apwPath = findApw();
  if (!apwPath) {
    return [
      messageItem(
        "APW was not found",
        "Install it with: brew install bendews/homebrew-tap/apw"
      ),
    ];
  }

  var authState = {};
  var passwords = tryApwWithAuthentication(
    apwPath,
    ["pw", "list", query],
    authState,
    { type: "lookup", query: query }
  );
  var oneTimeCodes = tryApwWithAuthentication(
    apwPath,
    ["otp", "list", query],
    authState,
    { type: "lookup", query: query }
  );

  if (passwords.authenticationPending || oneTimeCodes.authenticationPending) {
    return [authenticationActionItem()];
  }

  if (!passwords.ok && !oneTimeCodes.ok) {
    return [
      messageItem(
        "APW is unavailable",
        passwords.error ||
          oneTimeCodes.error ||
          "Make sure the APW service and its browser extension are running."
      ),
    ];
  }

  var records = mergeEntries(
    passwords.ok ? passwords.data.results : [],
    oneTimeCodes.ok ? oneTimeCodes.data.results : [],
    query
  );

  if (!records.length) {
    return [
      messageItem(
        "No Apple Passwords matches",
        "No accounts were returned for " + query
      ),
    ];
  }

  writeIndex(mergeIndex(readIndex(), records));
  return resultsForRecords(records);
}

function resultsForRecords(records) {
  if (records.length === 1) {
    return showFields(records[0]);
  }

  return records.map(function (record) {
    var capabilities = [];
    if (record.hasPassword) capabilities.push("Password");
    if (record.hasOtp) capabilities.push("Verification code");

    return {
      title: record.title || record.username || "(No username)",
      subtitle: record.domain,
      badge: capabilities.join(" + "),
      action: "showFields",
      actionArgument: record,
    };
  });
}

function showFields(record) {
  var fields = [
    pasteCopyFieldItem(
      record.username || "(Empty username)",
      "Username",
      record.username,
      "pasteUsername"
    ),
  ];

  if (record.hasPassword) {
    fields.push({
      title: "Paste password",
      subtitle: record.domain,
      badge: "Paste ↩",
      action: "fetchAndPastePassword",
      actionArgument: record,
      actionReturnsItems: true,
    });
  }

  if (record.hasOtp) {
    fields.push({
      title: "Paste verification code",
      subtitle: record.domain,
      badge: "Paste ↩",
      action: "fetchAndPasteOtp",
      actionArgument: record,
      actionReturnsItems: true,
    });
  }

  if (record.hasPassword) {
    fields.push({
      title: "Copy password",
      subtitle: record.domain,
      badge: "Copy ↩",
      action: "copyPassword",
      actionArgument: record,
      actionReturnsItems: true,
    });
  }

  if (record.hasOtp) {
    fields.push({
      title: "Copy verification code",
      subtitle: record.domain,
      badge: "Copy ↩",
      action: "copyOtp",
      actionArgument: record,
      actionReturnsItems: true,
    });
  }

  uniqueDomains(record.sites).forEach(function (domain) {
    fields.push({
      title: domain,
      subtitle: "Associated domain",
      url: "https://" + domain,
    });
  });

  return fields;
}

function fetchAndPastePassword(record) {
  var apwPath = findApw();
  if (!apwPath) return notifyFailure("APW was not found.");

  var response = tryApwWithAuthentication(
    apwPath,
    ["pw", "get", record.domain, record.username],
    {},
    { type: "pastePassword", record: record }
  );
  if (response.authenticationPending) return [authenticationActionItem()];
  if (!response.ok) return notifyFailure(response.error);

  var entry = selectSecretEntry(response.data.results, record);
  if (!entry || !entry.password) {
    return notifyFailure("APW did not return the selected password.");
  }
  pasteValue(entry.password, "Password");
}

function fetchAndPasteOtp(record) {
  var apwPath = findApw();
  if (!apwPath) return notifyFailure("APW was not found.");

  var response = tryApwWithAuthentication(
    apwPath,
    ["otp", "get", record.domain],
    {},
    { type: "pasteOtp", record: record }
  );
  if (response.authenticationPending) return [authenticationActionItem()];
  if (!response.ok) return notifyFailure(response.error);

  var entry = selectSecretEntry(response.data.results, record);
  if (!entry || !entry.code) {
    return notifyFailure("APW did not return the selected verification code.");
  }
  pasteValue(entry.code, "Verification code");
}

function copyPassword(record) {
  var apwPath = findApw();
  if (!apwPath) return notifyFailure("APW was not found.");

  var response = tryApwWithAuthentication(
    apwPath,
    ["pw", "get", record.domain, record.username],
    {},
    { type: "copyPassword", record: record }
  );
  if (response.authenticationPending) return [authenticationActionItem()];
  if (!response.ok) return notifyFailure(response.error);

  var entry = selectSecretEntry(response.data.results, record);
  if (!entry || !entry.password) {
    return notifyFailure("APW did not return the selected password.");
  }
  LaunchBar.setClipboardString(String(entry.password));
}

function copyOtp(record) {
  var apwPath = findApw();
  if (!apwPath) return notifyFailure("APW was not found.");

  var response = tryApwWithAuthentication(
    apwPath,
    ["otp", "get", record.domain],
    {},
    { type: "copyOtp", record: record }
  );
  if (response.authenticationPending) return [authenticationActionItem()];
  if (!response.ok) return notifyFailure(response.error);

  var entry = selectSecretEntry(response.data.results, record);
  if (!entry || !entry.code) {
    return notifyFailure("APW did not return the selected verification code.");
  }
  LaunchBar.setClipboardString(String(entry.code));
}

function pasteCopyFieldItem(title, subtitle, value, action) {
  var item = {
    title: title,
    subtitle: subtitle,
    badge: "Paste ↩ · Copy ⌘C",
    action: action,
    actionArgument: value,
  };
  if (value) item.url = String(value);
  return item;
}

function pasteUsername(value) {
  pasteValue(value, "Username");
}

function pasteValue(value, label) {
  if (!value) return notifyFailure(label + " is empty.");
  LaunchBar.paste(String(value));
}

function indexPath() {
  return Action.supportPath + "/domain-index.json";
}

function readIndex() {
  try {
    var data = File.readJSON(indexPath());
    return Array.isArray(data) ? data : [];
  } catch (error) {
    return [];
  }
}

function writeIndex(records) {
  try {
    File.writeJSON(records, indexPath());
  } catch (error) {
    LaunchBar.log("Could not update the local domain index: " + error.message);
  }
}

function findApw() {
  for (var i = 0; i < APW_PATHS.length; i += 1) {
    if (File.exists(APW_PATHS[i])) return APW_PATHS[i];
  }

  try {
    var discovered = LaunchBar.execute("/usr/bin/which", "apw").trim();
    if (discovered && File.exists(discovered)) return discovered;
  } catch (error) {
    // The standard Homebrew and MacPorts locations above cover normal installs.
  }
  return null;
}

function executeApw(path, args) {
  var command = [
    "/bin/sh",
    "-c",
    '"$@" 2>&1; exit 0',
    "apw-launchbar",
    path,
  ].concat(args);
  var output = LaunchBar.execute.apply(LaunchBar, command);
  var lines = String(output || "").trim().split(/\r?\n/);

  for (var i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch (error) {
      // APW may print daemon status lines before its final JSON object.
    }
  }
  throw new Error("APW returned no readable JSON.");
}

function tryApw(path, args) {
  try {
    var data = executeApw(path, args);
    if (data.status !== 0) {
      return {
        ok: false,
        status: data.status,
        error: data.error || "APW returned status " + data.status + ".",
      };
    }
    return { ok: true, data: data };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error:
        error && error.message
          ? error.message
          : "Make sure the APW service and its browser extension are running.",
    };
  }
}

function tryApwWithAuthentication(path, args, state, resume) {
  state = state || {};
  if (state.failure) return state.failure;

  var response = tryApw(path, args);
  if (response.ok || response.status !== APW_INVALID_SESSION) return response;

  if (state.attempted) return response;
  state.attempted = true;

  var authentication = beginAuthentication(path, resume);
  if (!authentication.ok) {
    state.failure = authentication;
    return authentication;
  }

  state.failure = authentication;
  return authentication;
}

function beginAuthentication(path, resume) {
  var challenge = tryApw(path, ["auth", "request"]);
  if (!challenge.ok) {
    return {
      ok: false,
      status: challenge.status,
      error:
        challenge.status === APW_INVALID_SESSION
          ? "APW could not start authentication. Make sure its service and browser extension are running."
          : challenge.error,
    };
  }

  clearVerificationInputHistory();
  Action.preferences.pendingAuthentication = {
    createdAt: Date.now(),
    resume: resume,
  };

  return {
    ok: false,
    status: APW_INVALID_SESSION,
    authenticationPending: true,
    error: "Enter the six-digit Apple Passwords verification code in LaunchBar.",
  };
}

function clearVerificationInputHistory() {
  try {
    LaunchBar.execute(
      "/usr/bin/defaults",
      "write",
      "at.obdev.LaunchBar",
      "TextInputHistory",
      "-dict-add",
      AUTHENTICATION_ACTION_BUNDLE,
      ""
    );
  } catch (error) {
    LaunchBar.log(
      "Could not clear verification-code input history: " + error.message
    );
  }
}

function authenticateBeforeIndexedResults(records, query) {
  var apwPath = findApw();
  if (!apwPath || !records.length) return null;

  var probe = tryApw(apwPath, ["pw", "list", records[0].domain]);
  if (probe.status !== APW_INVALID_SESSION) return null;

  var authentication = beginAuthentication(apwPath, {
    type: "lookup",
    query: query,
  });
  if (authentication.authenticationPending) {
    return [authenticationActionItem()];
  }

  return [
    messageItem(
      "APW is unavailable",
      authentication.error ||
        "Make sure the APW service and its browser extension are running."
    ),
  ];
}

function authenticationActionItem() {
  return {
    title: "Enter verification code",
    subtitle: "Press Return to open a fresh six-digit code field.",
    alwaysShowsSubtitle: true,
    badge: "Authenticate",
    actionBundleIdentifier: AUTHENTICATION_ACTION_BUNDLE,
  };
}

function readPendingAuthentication() {
  var pending = Action.preferences.pendingAuthentication;
  if (
    !pending ||
    !pending.resume ||
    !pending.createdAt ||
    Date.now() - pending.createdAt > AUTHENTICATION_TIMEOUT_MS
  ) {
    clearPendingAuthentication();
    return null;
  }
  return pending;
}

function clearPendingAuthentication() {
  Action.preferences.pendingAuthentication = null;
}

function submitAuthenticationResponse(code) {
  var pending = readPendingAuthentication();
  if (!pending) {
    return [
      messageItem(
        "Authentication request expired",
        "Run the Apple Passwords search again to request a new verification code."
      ),
    ];
  }
  if (!/^\d{6}$/.test(String(code || ""))) {
    return [
      messageItem(
        "Invalid verification code",
        "Enter the complete six-digit code shown by macOS."
      ),
    ];
  }

  var apwPath = findApw();
  if (!apwPath) {
    clearPendingAuthentication();
    return [messageItem("APW was not found", "Install APW and try again.")];
  }

  var response = tryApw(apwPath, ["auth", "response", "--pin", code]);
  clearPendingAuthentication();
  if (!response.ok) {
    return [
      messageItem(
        "APW authentication failed",
        response.error ||
          "Run the lookup again to request a new Apple Passwords verification code."
      ),
    ];
  }

  var resume = pending.resume;
  if (resume.type === "lookup") {
    return runLookup(resume.query);
  }
  if (resume.type === "copyPassword") {
    return copyPassword(resume.record);
  }
  if (resume.type === "copyOtp") {
    return copyOtp(resume.record);
  }
  if (resume.type === "pastePassword") {
    return fetchAndPastePassword(resume.record);
  }
  if (resume.type === "pasteOtp") {
    return fetchAndPasteOtp(resume.record);
  }

  return [
    messageItem(
      "APW authenticated",
      "Run your Apple Passwords lookup again."
    ),
  ];
}

function messageItem(title, subtitle) {
  return {
    title: title,
    subtitle: subtitle,
    action: "showMessage",
    actionArgument: { title: title, subtitle: subtitle },
  };
}

function showMessage(message) {
  LaunchBar.displayNotification({
    title: message.title,
    string: message.subtitle,
  });
}

function notifyFailure(message) {
  LaunchBar.displayNotification({
    title: "Apple Passwords",
    string: message || "The requested value could not be retrieved.",
  });
}
