"use strict";

const LINKS = [
  "https://www.facebook.com/share/1PWwWcuVAm/?mibextid=wwXIfr",
  "https://www.facebook.com/share/1BQG8iRTE1/?mibextid=wwXIfr",
  "https://www.facebook.com/share/19NaYjAYMu/?mibextid=wwXIfr",
];

const BASE_INSULTS = [
  "Ang lakas ng confidence mo, kaso wala namang kasamang ambag.",
  "May point ka sana, kaso nawala bago makarating sa dulo.",
  "Parang WiFi ka—malakas ang signal pero walang connection.",
  "Ang bilis mong mag-ingay, mabagal naman umintindi.",
  "Hindi ka bobo, advanced lang talaga ang level ng kalat mo.",
  "May utak ka naman, naka-airplane mode lang yata.",
  "Parang loading screen ka—matagal pero walang nangyayari.",
  "Kung yabang ang currency, milyonaryo ka na.",
  "Ang taas ng standards mo, pero mababa ang output.",
  "Hindi ka late sa usapan, late ka lang sa pag-intindi.",
  "May resibo ka ba o puro confidence lang dala mo?",
  "Parang group project ka—present sa pangalan, absent sa ambag.",
  "Ang galing mong magpaliwanag ng bagay na hindi mo naman gets.",
  "Hindi kita minamaliit, tinatapat lang kita sa actual performance mo.",
  "Parang calculator ka na walang battery—numbers lang ang alam, walang result.",
  "Ang tapang mo sa chat, parang may unlimited lives.",
  "Kung common sense ang exam, mukhang absent ka.",
  "Ang dami mong sinabi, pero wala pa ring laman.",
  "Parang alarm ka—maingay pero madaling i-snooze.",
  "Hindi ka nakakalito, consistent ka lang talagang mali.",
  "May character development ka ba o permanenteng ganito?",
  "Ang lakas ng entrance mo, wala namang ending.",
  "Parang spoiler ka—lahat sinasabi, wala namang sense.",
  "Hindi ka mahirap intindihin, mahirap lang seryosohin.",
  "Kung effort ang basehan, baka ikaw ang bonus question.",
  "Ang confidence mo pang-final boss, ang performance tutorial level.",
  "Parang screenshot ka—kuha nang kuha pero walang context.",
  "Ang galing mong maging problema kahit walang nagtatanong.",
  "May ambag ka ba o moral support lang sa sarili mo?",
  "Parang broken link ka—pinipindot pero walang napupuntahan.",
  "Hindi ka useless, excellent example ka lang ng what not to do.",
  "Ang haba ng speech mo, bitin pa rin sa substance.",
  "Parang expired promo code—excited gamitin pero wala nang value.",
  "Hindi kita inaaway, binibigyan lang kita ng mirror moment.",
  "Kung logic ang usapan, mukhang guest ka lang.",
  "Ang lakas mong mag-flex, pero saan banda?",
  "Parang keyboard ka—ang daming keys, pero walang tamang input.",
  "Hindi ka mysterious, unclear lang talaga.",
  "Parang draft message ka—hindi dapat na-send.",
  "Ang bilis mong mag-react, sana ganun din kabilis mag-isip.",
  "May potential ka sana, kaso busy sa pagiging maingay.",
  "Parang traffic ka—nakaka-delay at walang gustong ma-stuck sa'yo.",
  "Hindi ka extra, ikaw yung unnecessary update.",
  "Ang dami mong opinion, kulang naman sa evidence.",
  "Parang password ka—complicated pero madaling hulaan.",
  "Kung pagiging makulit ang sport, champion ka na.",
  "Hindi ka intimidating, persistent lang talaga ang noise level mo.",
  "Parang low battery ka—mahina na nga, ang ingay pa.",
  "Ang tapang ng typing, parang hindi binabasa bago pindutin send.",
  "Hindi ka underrated, accurately rated ka lang.",
  "Parang pop-up ad ka—lumalabas kahit walang may gusto.",
  "May timing ka naman, laging mali.",
  "Ang galing mong gumawa ng issue na ikaw rin ang dahilan.",
  "Parang autocorrect ka—confident pero madalas mali.",
  "Hindi ka deep, mahaba lang ang caption.",
  "Parang demo account ka—maraming features pero walang actual use.",
  "Ang lakas ng aura mo, pero saan galing ang battery?",
  "Hindi ka villain, inconvenience ka lang.",
  "Parang buffering video ka—everyone is waiting for the point.",
  "May sagot ka lagi kahit wala namang tanong.",
  "Kung silence ang challenge, matagal ka nang eliminated.",
  "Parang duplicate file ka—pareho lang pero walang dagdag na value.",
  "Hindi ka hard to get, hard to tolerate lang.",
  "Ang ganda ng confidence, sayang hindi sinabayan ng accuracy.",
  "Parang group chat notification ka—biglang sumusulpot at nakakagulat.",
  "Hindi ka threat, notification ka lang.",
  "Ang lakas mong mang-call out, pero sariling folder mo puro issues.",
  "Parang free trial ka—maingay sa simula, walang silbi sa dulo.",
  "Hindi ka unpredictable, predictable lang ang pagiging mali mo.",
  "May direction ka ba o umiikot ka lang sa parehong punto?",
  "Parang typo ka—small mistake pero nakakainis buong sentence.",
  "Ang dami mong shortcut, pero hindi pa rin makaabot sa point.",
  "Hindi ka complicated, magulo ka lang.",
  "Parang 1% battery ka—konti na lang pero ayaw pa ring tumahimik.",
  "Ang bilis mong gumawa ng conclusion, sana binabasa mo muna ang question.",
  "Parang empty folder ka—may label pero walang laman.",
  "Hindi ka savage, noisy lang.",
  "May confidence kang pang-expert, research mong pang-comment section.",
  "Parang random password generator—walang pattern at walang makaintindi.",
  "Ang galing mong gawing personal ang bagay na hindi naman tungkol sa'yo.",
  "Hindi ka main character, notification ka lang sa eksena.",
  "Parang deleted message ka—mas okay sana kung hindi na nakita.",
  "Ang bilis mong sumagot, ang bagal mong maka-gets.",
  "May resibo ka ba sa claims mo o gawa-gawa lang season finale?",
  "Parang unstable connection ka—paulit-ulit pero walang progress.",
  "Hindi ka scary, inconvenient ka.",
  "Ang taas ng volume mo, mababa naman ang signal.",
  "Parang outdated app ka—may update available pero ayaw mong tanggapin.",
  "Hindi ka complicated puzzle, maling instruction lang talaga.",
  "Kung confidence lang ang puhunan, panalo ka na sana.",
  "Parang notification badge ka—nakikita ka, pero walang gustong buksan.",
  "Ang bilis mong manghusga, sana bilis mo ring tumanggap ng facts.",
  "Hindi ka loud and proud, loud lang.",
  "Parang empty chair ka—present pero walang contribution.",
  "May plot ka ba o puro filler episodes?",
  "Hindi ka original, recycled opinion ka.",
  "Parang bad edit ka—mas okay sana kung hindi isinama.",
  "Ang dami mong layers, lahat naman manipis.",
  "Hindi ka boss fight, side quest ka.",
  "Parang captcha ka—nakakainis at minsan walang tamang sagot.",
  "Ang tapang mong magsalita sa bagay na hindi mo pa na-check.",
  "Hindi ka intimidating, dramatic ka lang.",
  "Parang expired screenshot—wala nang silbi kahit mataas ang resolution.",
];

const TAGS = [
  "Ayun lang, resibo muna.",
  "Pakibalik kapag may facts na.",
  "Next round, may proof naman sana.",
  "Kalma lang, hindi ito speedrun.",
  "Pahinga muna ang confidence.",
  "Hinga muna bago mag-type.",
  "Research muna bago comeback.",
  "Hindi lahat ng iniisip kailangang i-send.",
  "May edit button pa, gamitin mo.",
  "Baka gusto mong i-revise yan.",
];

const INSULTS = BASE_INSULTS.concat(
  BASE_INSULTS.map((line, index) => line + " " + TAGS[index % TAGS.length])
);

const threadState = new Map();
const lastReplyAt = new Map();

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function getThreadEnabled(threadID) {
  return threadState.get(String(threadID)) === true;
}

function setThreadEnabled(threadID, enabled) {
  threadState.set(String(threadID), Boolean(enabled));
}

function getRandomBanat() {
  const insult = randomItem(INSULTS);
  const link = randomItem(LINKS);
  return insult + "\n\n୨୧ resibo: " + link;
}

function classifyMessage(body) {
  const text = String(body || "").toLowerCase();

  if (/(^|\s)(weh|wehh|weh\?|weh!)(\s|$)/i.test(text)) return "weh";
  if (/\b(ako|akin|mine|best|number ?1|top ?1|pinakamagaling|panalo|winner)\b|\b(ang galing ko|magaling ako|ako na|ako lang)\b/i.test(text)) return "brag";
  if (/\b(bobo|tanga|stupid|idiot|mali ka|wrong|cap|sinungaling|fake|walang kwenta)\b|\b(hindi totoo|source\?|resibo\?)\b/i.test(text)) return "argument";
  if (/(😭|💀|🤣|😂|lmao|lol|haha)/i.test(text)) return "chaos";
  if (/(\?|\b(bakit|paano|ano ba|saan ba|seryoso)\b)/i.test(text)) return "question";
  return "normal";
}

function getResponseChance(category) {
  switch (category) {
    case "weh": return 0.90;
    case "brag": return 0.65;
    case "argument": return 0.60;
    case "chaos": return 0.45;
    case "question": return 0.35;
    default: return 0.15;
  }
}

function shouldReply(threadID, body) {
  const key = String(threadID);
  const now = Date.now();
  const last = lastReplyAt.get(key) || 0;
  const category = classifyMessage(body);

  if (now - last < 25_000) return false;
  if (Math.random() > getResponseChance(category)) return false;

  lastReplyAt.set(key, now);
  return true;
}

function clearThreadRuntime(threadID) {
  const key = String(threadID);
  lastReplyAt.delete(key);
}

module.exports = {
  LINKS,
  INSULTS,
  randomItem,
  getThreadEnabled,
  setThreadEnabled,
  getRandomBanat,
  shouldReply,
  classifyMessage,
  getResponseChance,
  clearThreadRuntime,
};
