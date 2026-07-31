/*
 * Pure data handling shared by the LaunchBar action and its Node test suite.
 * This file intentionally avoids modern module syntax because LaunchBar loads it
 * with include().
 */

function normalizeTypedDomain(input) {
  var domain = normalizeQuery(input);

  if (!isCompleteDomain(domain)) {
    throw new Error("Enter a complete domain, such as example.com.");
  }

  return domain;
}

function normalizeQuery(input) {
  var query = String(input || "").trim().toLowerCase();

  if (!query) {
    throw new Error("Enter a domain or hostname.");
  }
  if (query.indexOf("://") !== -1 || /[/?#@:]/.test(query) || /\s/.test(query)) {
    throw new Error("Enter only a domain or hostname.");
  }
  if (query.charAt(query.length - 1) === ".") {
    query = query.slice(0, -1);
  }
  if (query.length > 253 || query.indexOf("..") !== -1) {
    throw new Error("That does not look like a valid domain or hostname.");
  }

  var labels = query.split(".");
  for (var i = 0; i < labels.length; i += 1) {
    var label = labels[i];
    if (
      !label ||
      label.length > 63 ||
      label.charAt(0) === "-" ||
      label.charAt(label.length - 1) === "-" ||
      !/^[a-z0-9\u0080-\uffff-]+$/i.test(label)
    ) {
      throw new Error("That does not look like a valid domain or hostname.");
    }
  }

  return query;
}

function isCompleteDomain(query) {
  return String(query || "").split(".").length >= 2;
}

function domainFromValue(value) {
  var domain = String(value || "").trim().toLowerCase();
  if (!domain) return "";

  domain = domain.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  domain = domain.split(/[/?#]/, 1)[0];
  domain = domain.replace(/:\d+$/, "");
  domain = domain.replace(/\.$/, "");
  return domain;
}

function uniqueDomains(values) {
  var seen = {};
  var result = [];

  (values || []).forEach(function (value) {
    var domain = domainFromValue(value);
    if (domain && !seen[domain]) {
      seen[domain] = true;
      result.push(domain);
    }
  });

  return result;
}

function relationshipRank(candidate, query) {
  if (candidate === query) return 0;
  if (candidate.slice(-(query.length + 1)) === "." + query) return 1;
  if (query.slice(-(candidate.length + 1)) === "." + candidate) return 2;
  if (
    candidate.split(".").some(function (label) {
      return label.indexOf(query) === 0;
    })
  ) {
    return 3;
  }
  if (candidate.indexOf(query) !== -1) return 4;
  return 5;
}

function bestDomain(domains, query) {
  var candidates = uniqueDomains(domains);
  if (!candidates.length) return query;

  return candidates.slice().sort(function (left, right) {
    var rankDifference =
      relationshipRank(left, query) - relationshipRank(right, query);
    if (rankDifference !== 0) return rankDifference;
    return left.localeCompare(right);
  })[0];
}

function normalizedUsername(value) {
  return String(value || "").trim();
}

function sameIdentity(left, right) {
  return (
    normalizedUsername(left.username).toLowerCase() ===
      normalizedUsername(right.username).toLowerCase() &&
    left.domain === right.domain
  );
}

function mergeEntries(passwordEntries, otpEntries, query) {
  var records = [];

  (passwordEntries || []).forEach(function (entry) {
    var sites = uniqueDomains(
      [entry.domain].concat(Array.isArray(entry.sites) ? entry.sites : [])
    );
    var domain = bestDomain(sites, query);
    var username = normalizedUsername(entry.username);
    var candidate = {
      title: String(entry.title || "").trim(),
      username: username,
      domain: domain,
      sites: sites.length ? sites : [domain],
      hasPassword: true,
      hasOtp: false,
    };

    var duplicate = records.filter(function (record) {
      return sameIdentity(record, candidate) && record.title === candidate.title;
    })[0];

    if (duplicate) {
      duplicate.sites = uniqueDomains(duplicate.sites.concat(candidate.sites));
    } else {
      records.push(candidate);
    }
  });

  (otpEntries || []).forEach(function (entry) {
    var domain = bestDomain([entry.domain], query);
    var candidate = {
      title: "",
      username: normalizedUsername(entry.username),
      domain: domain,
      sites: [domain],
      hasPassword: false,
      hasOtp: true,
    };
    var existing = records.filter(function (record) {
      return sameIdentity(record, candidate);
    })[0];

    if (existing) {
      existing.hasOtp = true;
    } else {
      records.push(candidate);
    }
  });

  return records.sort(function (left, right) {
    var rankDifference =
      relationshipRank(left.domain, query) -
      relationshipRank(right.domain, query);
    if (rankDifference !== 0) return rankDifference;

    var domainDifference = left.domain.localeCompare(right.domain);
    if (domainDifference !== 0) return domainDifference;

    return left.username.localeCompare(right.username);
  });
}

function selectSecretEntry(entries, selected) {
  var wantedUsername = normalizedUsername(selected.username).toLowerCase();
  var wantedDomains = uniqueDomains(
    [selected.domain].concat(selected.sites || [])
  );

  var exact = (entries || []).filter(function (entry) {
    var entryUsername = normalizedUsername(entry.username).toLowerCase();
    var entryDomains = uniqueDomains(
      [entry.domain].concat(Array.isArray(entry.sites) ? entry.sites : [])
    );
    var domainMatches = entryDomains.some(function (domain) {
      return wantedDomains.indexOf(domain) !== -1;
    });
    return entryUsername === wantedUsername && domainMatches;
  });

  if (exact.length) return exact[0];

  var usernameMatch = (entries || []).filter(function (entry) {
    return normalizedUsername(entry.username).toLowerCase() === wantedUsername;
  });
  return usernameMatch.length === 1 ? usernameMatch[0] : null;
}

function recordIdentity(record) {
  return [
    String(record.username || "").toLowerCase(),
    String(record.domain || "").toLowerCase(),
    String(record.title || "").toLowerCase(),
  ].join("\n");
}

function mergeIndex(existing, additions) {
  var byIdentity = {};

  (existing || []).concat(additions || []).forEach(function (record) {
    var identity = recordIdentity(record);
    if (!byIdentity[identity]) {
      byIdentity[identity] = {
        title: String(record.title || ""),
        username: String(record.username || ""),
        domain: domainFromValue(record.domain),
        sites: uniqueDomains(record.sites || [record.domain]),
        hasPassword: Boolean(record.hasPassword),
        hasOtp: Boolean(record.hasOtp),
      };
      return;
    }

    var saved = byIdentity[identity];
    saved.sites = uniqueDomains(saved.sites.concat(record.sites || []));
    saved.hasPassword = saved.hasPassword || Boolean(record.hasPassword);
    saved.hasOtp = saved.hasOtp || Boolean(record.hasOtp);
  });

  return Object.keys(byIdentity).map(function (identity) {
    return byIdentity[identity];
  });
}

function filterIndex(records, query) {
  return (records || [])
    .filter(function (record) {
      return (
        String(record.domain || "").toLowerCase().indexOf(query) !== -1 ||
        (record.sites || []).some(function (site) {
          return String(site).toLowerCase().indexOf(query) !== -1;
        })
      );
    })
    .sort(function (left, right) {
      var rankDifference =
        relationshipRank(left.domain, query) -
        relationshipRank(right.domain, query);
      if (rankDifference !== 0) return rankDifference;
      var domainDifference = left.domain.localeCompare(right.domain);
      if (domainDifference !== 0) return domainDifference;
      return left.username.localeCompare(right.username);
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    bestDomain: bestDomain,
    domainFromValue: domainFromValue,
    filterIndex: filterIndex,
    isCompleteDomain: isCompleteDomain,
    mergeIndex: mergeIndex,
    mergeEntries: mergeEntries,
    normalizeQuery: normalizeQuery,
    normalizeTypedDomain: normalizeTypedDomain,
    relationshipRank: relationshipRank,
    selectSecretEntry: selectSecretEntry,
    uniqueDomains: uniqueDomains,
  };
}
