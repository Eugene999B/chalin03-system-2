const DEFAULT_SUGGESTION_SCORE = 58;
const ALGORITHM_VERSION = "customer-identity-v1.0";
const NAME_TITLES = new Set([
  "mr",
  "mrs",
  "miss",
  "ms",
  "dr",
  "prof",
  "rev",
  "pastor",
  "apostle",
  "elder",
  "chief",
  "alhaji",
  "hajia",
  "madam",
  "sir",
]);

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function roundMoney(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : 0;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith("0")) {
    digits = `233${digits.slice(1)}`;
  } else if (digits.length === 9) {
    digits = `233${digits}`;
  }

  if (digits.length >= 9) return digits.slice(-12);
  return digits;
}

function nameProfile(value) {
  const normalized = normalizeText(value);
  const tokens = normalized
    .split(" ")
    .filter(Boolean)
    .filter((token) => !NAME_TITLES.has(token));
  const safeTokens = tokens.length > 0 ? tokens : normalized.split(" ").filter(Boolean);
  const sortedTokens = [...safeTokens].sort();

  return {
    normalized: safeTokens.join(" "),
    compact: safeTokens.join(""),
    sorted: sortedTokens.join(" "),
    tokens: safeTokens,
    first: safeTokens[0] || "",
    last: safeTokens[safeTokens.length - 1] || "",
    phonetic: safeTokens.map(soundex).filter(Boolean).join("-"),
  };
}

function soundex(value) {
  const text = normalizeText(value).replace(/\s/g, "");
  if (!text) return "";

  const first = text[0].toUpperCase();
  const groups = {
    b: "1",
    f: "1",
    p: "1",
    v: "1",
    c: "2",
    g: "2",
    j: "2",
    k: "2",
    q: "2",
    s: "2",
    x: "2",
    z: "2",
    d: "3",
    t: "3",
    l: "4",
    m: "5",
    n: "5",
    r: "6",
  };

  let result = first;
  let previous = groups[text[0]] || "";

  for (const letter of text.slice(1)) {
    const code = groups[letter] || "";
    if (code && code !== previous) result += code;
    previous = code;
    if (result.length === 4) break;
  }

  return `${result}000`.slice(0, 4);
}

function diceCoefficient(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const counts = new Map();
  for (let index = 0; index < a.length - 1; index += 1) {
    const pair = a.slice(index, index + 2);
    counts.set(pair, (counts.get(pair) || 0) + 1);
  }

  let matches = 0;
  for (let index = 0; index < b.length - 1; index += 1) {
    const pair = b.slice(index, index + 2);
    const count = counts.get(pair) || 0;
    if (count > 0) {
      matches += 1;
      counts.set(pair, count - 1);
    }
  }

  return (2 * matches) / (a.length + b.length - 2);
}

function tokenJaccard(leftTokens, rightTokens) {
  const left = new Set(leftTokens || []);
  const right = new Set(rightTokens || []);
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  left.forEach((token) => {
    if (right.has(token)) intersection += 1;
  });

  return intersection / (left.size + right.size - intersection);
}

function customerCompleteness(customer) {
  let score = 0;
  if (cleanText(customer?.name, 255)) score += 3;
  if (normalizePhone(customer?.phone)) score += 3;
  if (normalizeText(customer?.location)) score += 2;
  score += Math.min(20, Number(customer?.sale_count || 0) * 2);
  score += Math.min(12, Number(customer?.debt_count || 0) * 2);
  score += Math.min(10, Number(customer?.transaction_count || 0));
  return score;
}

function publicCustomer(customer) {
  return {
    customer_id: Number(customer.customer_id || customer.id),
    customer_name: customer.customer_name || customer.name || "",
    customer_phone: customer.customer_phone || customer.phone || "",
    customer_location: customer.customer_location || customer.location || "",
    sale_count: Number(customer.sale_count || 0),
    debt_count: Number(customer.debt_count || 0),
    active_debt_count: Number(customer.active_debt_count || 0),
    outstanding_balance: roundMoney(customer.outstanding_balance),
    total_sales_value: roundMoney(customer.total_sales_value),
    transaction_count: Number(customer.transaction_count || 0),
    first_activity_at: customer.first_activity_at || customer.created_at || null,
    last_activity_at: customer.last_activity_at || customer.updated_at || null,
    created_at: customer.created_at || null,
    updated_at: customer.updated_at || null,
  };
}

function compareCustomerPair(left, right) {
  const leftName = nameProfile(left.customer_name || left.name);
  const rightName = nameProfile(right.customer_name || right.name);
  const leftPhone = normalizePhone(left.customer_phone || left.phone);
  const rightPhone = normalizePhone(right.customer_phone || right.phone);
  const leftLocation = normalizeText(left.customer_location || left.location);
  const rightLocation = normalizeText(right.customer_location || right.location);

  const nameDice = diceCoefficient(leftName.compact, rightName.compact);
  const tokenOverlap = tokenJaccard(leftName.tokens, rightName.tokens);
  const locationSimilarity = diceCoefficient(
    leftLocation.replace(/\s/g, ""),
    rightLocation.replace(/\s/g, "")
  );

  let score = 0;
  const reasons = [];
  const warnings = [];

  if (leftPhone && rightPhone && leftPhone === rightPhone) {
    score += 62;
    reasons.push("Same normalized phone number");
  } else if (
    leftPhone &&
    rightPhone &&
    leftPhone.length >= 9 &&
    rightPhone.length >= 9 &&
    leftPhone.slice(-9) === rightPhone.slice(-9)
  ) {
    score += 58;
    reasons.push("Same phone number after country-code normalization");
  } else if (leftPhone && rightPhone && leftPhone !== rightPhone) {
    score -= 20;
    warnings.push("Both records have different phone numbers");
  }

  if (leftName.compact && leftName.compact === rightName.compact) {
    score += 48;
    reasons.push("Exact normalized name");
  } else if (leftName.sorted && leftName.sorted === rightName.sorted) {
    score += 45;
    reasons.push("Same name words in a different order");
  } else {
    if (nameDice >= 0.94) {
      score += 42;
      reasons.push("Very close spelling match");
    } else if (nameDice >= 0.86) {
      score += 34;
      reasons.push("Close spelling match");
    } else if (nameDice >= 0.76) {
      score += 24;
      reasons.push("Possible spelling variation");
    }

    if (tokenOverlap >= 0.8) {
      score += 12;
      reasons.push("Most name words match");
    } else if (tokenOverlap >= 0.5) {
      score += 7;
      reasons.push("Some name words match");
    }
  }

  if (
    leftName.phonetic &&
    rightName.phonetic &&
    leftName.phonetic === rightName.phonetic &&
    leftName.compact !== rightName.compact
  ) {
    score += 10;
    reasons.push("Names sound alike");
  }

  if (leftLocation && rightLocation) {
    if (leftLocation === rightLocation) {
      score += 14;
      reasons.push("Same location");
    } else if (locationSimilarity >= 0.86) {
      score += 10;
      reasons.push("Very similar location");
    } else if (locationSimilarity >= 0.72) {
      score += 6;
      reasons.push("Related location spelling");
    }
  }

  if (!leftPhone && !rightPhone) warnings.push("Neither record has a phone number");
  if (!leftLocation && !rightLocation) warnings.push("Neither record has a location");

  const finalScore = Math.round(clamp(score, 0, 100));
  const confidence =
    finalScore >= 88 ? "very_likely" : finalScore >= 74 ? "likely" : "review";

  const leftCompleteness = customerCompleteness(left);
  const rightCompleteness = customerCompleteness(right);
  let recommendedMasterId;

  if (leftCompleteness !== rightCompleteness) {
    recommendedMasterId =
      leftCompleteness > rightCompleteness
        ? Number(left.customer_id || left.id)
        : Number(right.customer_id || right.id);
  } else {
    recommendedMasterId = Math.min(
      Number(left.customer_id || left.id),
      Number(right.customer_id || right.id)
    );
  }

  return {
    score: finalScore,
    confidence,
    reasons,
    warnings,
    name_similarity: Number(nameDice.toFixed(3)),
    location_similarity: Number(locationSimilarity.toFixed(3)),
    recommended_master_id: recommendedMasterId,
  };
}

function candidateBlockKeys(customer) {
  const profile = nameProfile(customer.customer_name || customer.name);
  const phone = normalizePhone(customer.customer_phone || customer.phone);
  const location = normalizeText(customer.customer_location || customer.location).replace(
    /\s/g,
    ""
  );
  const keys = [];

  if (phone) keys.push(`phone:${phone}`);
  if (profile.compact.length >= 4) {
    keys.push(`name:${profile.compact}`);
    keys.push(`prefix:${profile.compact.slice(0, 6)}`);
  }
  if (profile.sorted.length >= 4) keys.push(`sorted:${profile.sorted}`);
  if (profile.phonetic) keys.push(`phonetic:${profile.phonetic}`);
  if (profile.last && location) {
    keys.push(`last-location:${profile.last}:${location.slice(0, 7)}`);
  }

  return [...new Set(keys)];
}

function duplicateSuggestions(customers, minimumScore = DEFAULT_SUGGESTION_SCORE) {
  const blocks = new Map();
  const pairKeys = new Set();
  const pairs = [];

  customers.forEach((customer, index) => {
    candidateBlockKeys(customer).forEach((key) => {
      if (!blocks.has(key)) blocks.set(key, []);
      blocks.get(key).push(index);
    });
  });

  function evaluatePair(leftIndex, rightIndex) {
    if (leftIndex === rightIndex) return;
    const firstIndex = Math.min(leftIndex, rightIndex);
    const secondIndex = Math.max(leftIndex, rightIndex);
    const pairKey = `${firstIndex}:${secondIndex}`;
    if (pairKeys.has(pairKey)) return;
    pairKeys.add(pairKey);

    const left = customers[firstIndex];
    const right = customers[secondIndex];
    const comparison = compareCustomerPair(left, right);
    if (comparison.score < minimumScore) return;

    pairs.push({
      pair_id: `${left.customer_id || left.id}-${right.customer_id || right.id}`,
      ...comparison,
      customers: [publicCustomer(left), publicCustomer(right)],
    });
  }

  blocks.forEach((indexes) => {
    const boundedIndexes = indexes.slice(0, 150);
    for (let left = 0; left < boundedIndexes.length; left += 1) {
      for (let right = left + 1; right < boundedIndexes.length; right += 1) {
        evaluatePair(boundedIndexes[left], boundedIndexes[right]);
      }
    }
  });

  if (customers.length <= 350) {
    for (let left = 0; left < customers.length; left += 1) {
      for (let right = left + 1; right < customers.length; right += 1) {
        evaluatePair(left, right);
      }
    }
  }

  pairs.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return Number(left.customers[0].customer_id) - Number(right.customers[0].customer_id);
  });

  return pairs;
}

function duplicateGroups(pairs) {
  const adjacency = new Map();
  const customerMap = new Map();

  pairs.forEach((pair) => {
    const [left, right] = pair.customers;
    customerMap.set(Number(left.customer_id), left);
    customerMap.set(Number(right.customer_id), right);

    if (!adjacency.has(Number(left.customer_id))) {
      adjacency.set(Number(left.customer_id), new Set());
    }
    if (!adjacency.has(Number(right.customer_id))) {
      adjacency.set(Number(right.customer_id), new Set());
    }
    adjacency.get(Number(left.customer_id)).add(Number(right.customer_id));
    adjacency.get(Number(right.customer_id)).add(Number(left.customer_id));
  });

  const visited = new Set();
  const groups = [];

  adjacency.forEach((_, startingId) => {
    if (visited.has(startingId)) return;
    const stack = [startingId];
    const ids = [];

    while (stack.length > 0) {
      const current = stack.pop();
      if (visited.has(current)) continue;
      visited.add(current);
      ids.push(current);
      (adjacency.get(current) || []).forEach((next) => {
        if (!visited.has(next)) stack.push(next);
      });
    }

    const customers = ids.map((id) => customerMap.get(id)).filter(Boolean);
    const edges = pairs.filter((pair) =>
      pair.customers.every((customer) => ids.includes(Number(customer.customer_id)))
    );
    const highestScore = Math.max(...edges.map((edge) => edge.score));
    const recommended = customers
      .map((customer) => ({
        id: Number(customer.customer_id),
        score: customerCompleteness(customer),
      }))
      .sort((left, right) => right.score - left.score || left.id - right.id)[0];

    groups.push({
      group_id: ids.sort((left, right) => left - right).join("-"),
      confidence:
        highestScore >= 88 ? "very_likely" : highestScore >= 74 ? "likely" : "review",
      highest_score: highestScore,
      recommended_master_id: recommended?.id || ids[0],
      customers,
      matches: edges.map((edge) => ({
        pair_id: edge.pair_id,
        score: edge.score,
        confidence: edge.confidence,
        reasons: edge.reasons,
        warnings: edge.warnings,
      })),
    });
  });

  return groups.sort((left, right) => right.highest_score - left.highest_score);
}

module.exports = {
  ALGORITHM_VERSION,
  DEFAULT_SUGGESTION_SCORE,
  compareCustomerPair,
  duplicateGroups,
  duplicateSuggestions,
  normalizePhone,
  publicCustomer,
};
