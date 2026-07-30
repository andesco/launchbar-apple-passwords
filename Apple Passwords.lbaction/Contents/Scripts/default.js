include("core.js");

var APW_PATHS = [
  "/opt/homebrew/bin/apw",
  "/usr/local/bin/apw",
  "/opt/local/bin/apw",
];

function run(argument) {
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

  var passwords = tryApw(apwPath, ["pw", "list", query]);
  var oneTimeCodes = tryApw(apwPath, ["otp", "list", query]);

  if (!passwords.ok && !oneTimeCodes.ok) {
    return [
      messageItem(
        "APW is unavailable",
        passwords.error ||
          oneTimeCodes.error ||
          "Run “brew services start apw”, then “apw auth” in Terminal."
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
    if (record.hasOtp) capabilities.push("OTP");

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
    {
      title: record.username || "(Empty username)",
      subtitle: "Username",
      badge: "Paste",
      action: "pasteUsername",
      actionArgument: record,
    },
  ];

  if (record.hasPassword) {
    fields.push({
      title: "Password",
      subtitle: record.domain,
      badge: "Fetch and paste",
      action: "pastePassword",
      actionArgument: record,
    });
  }

  if (record.hasOtp) {
    fields.push({
      title: "One-time code",
      subtitle: record.domain,
      badge: "Fetch and paste",
      action: "pasteOtp",
      actionArgument: record,
    });
  }

  return fields;
}

function pasteUsername(record) {
  pasteValue(record.username, "Username");
}

function pastePassword(record) {
  var apwPath = findApw();
  if (!apwPath) return notifyFailure("APW was not found.");

  var response = tryApw(apwPath, [
    "pw",
    "get",
    record.domain,
    record.username,
  ]);
  if (!response.ok) return notifyFailure(response.error);

  var entry = selectSecretEntry(response.data.results, record);
  if (!entry || !entry.password) {
    return notifyFailure("APW did not return the selected password.");
  }
  pasteValue(entry.password, "Password");
}

function pasteOtp(record) {
  var apwPath = findApw();
  if (!apwPath) return notifyFailure("APW was not found.");

  var response = tryApw(apwPath, ["otp", "get", record.domain]);
  if (!response.ok) return notifyFailure(response.error);

  var entry = selectSecretEntry(response.data.results, record);
  if (!entry || !entry.code) {
    return notifyFailure("APW did not return the selected one-time code.");
  }
  pasteValue(entry.code, "One-time code");
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
  var command = [path].concat(args);
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
        error: data.error || "APW returned status " + data.status + ".",
      };
    }
    return { ok: true, data: data };
  } catch (error) {
    return {
      ok: false,
      error:
        error && error.message
          ? error.message
          : "Run “brew services start apw”, then “apw auth” in Terminal.",
    };
  }
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
