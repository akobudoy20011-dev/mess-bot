const authorizedUserId = String(
  process.env.ALAIZA_MESSENGER_ID || ""
).trim();

// Temporary users that the primary user has allowed Love to talk to.
const delegatedUsers = new Set();

function getAuthorizedUserId() {
  return authorizedUserId;
}

function isPrimaryUser(senderID) {
  const id = String(senderID || "").trim();

  return Boolean(
    authorizedUserId &&
    id === authorizedUserId
  );
}

function authorizeUser(senderID) {
  const id = String(senderID || "").trim();

  if (!id || isPrimaryUser(id)) {
    return false;
  }

  delegatedUsers.add(id);
  return true;
}

function revokeUser(senderID) {
  const id = String(senderID || "").trim();

  return delegatedUsers.delete(id);
}

function isDelegatedUser(senderID) {
  const id = String(senderID || "").trim();

  return delegatedUsers.has(id);
}

function isAuthorized(senderID) {
  return isPrimaryUser(senderID) || isDelegatedUser(senderID);
}

function clearDelegatedUsers() {
  delegatedUsers.clear();
}

function getAccessType(senderID) {
  if (isPrimaryUser(senderID)) {
    return "primary";
  }

  if (isDelegatedUser(senderID)) {
    return "delegated";
  }

  return "none";
}

module.exports = {
  getAuthorizedUserId,
  isAuthorized,
  isPrimaryUser,
  authorizeUser,
  revokeUser,
  isDelegatedUser,
  clearDelegatedUsers,
  getAccessType,
};
