function getAuthorizedUserId() {
  return String(process.env.ALAIZA_MESSENGER_ID || "").trim();
}

function isAuthorized(senderID) {
  const authorized = getAuthorizedUserId();
  return Boolean(authorized && String(senderID || "").trim() === authorized);
}

module.exports = { getAuthorizedUserId, isAuthorized };