// Each group has:
//  - triggers: words/phrases that activate this group (matched as whole words,
//              case-insensitive; multi-word triggers matched as a substring)
//  - replies: the preset lines, cycled in order (not random) — each new hit
//             advances to the next line, wrapping back to the start after
//             the last one
//  - index: internal cursor, do not set manually
//
// Cycling is per-group and in-memory: it resets to 0 whenever the bot
// restarts/redeploys (e.g. on every Render deploy).

const groups = [
  {
    name: "bot",
    triggers: ["bot"],
    index: 0,
    replies: [
      "ikaw bot",
      "mama mo bot",
      "asan bot?",
      "turo mo yung bot gamit mataba mong daliri",
      "bot nang bot, aning ka?",
      "ikaw mukhang bot tanga",
      "wag aning sa ope",
      "onga e, bot lola mong paro paro",
      "bot nganii yung lolo mo",
      "ona bot na",
      "sige, on ko bot ko tapos deep talk kayo",
      "pumapalag ka pala sa bot e",
      "on mo lola mong bot",
      "kuha lang ako plato, tapos kain tayo kasama bot ko",
      "may bot pala?",
      "asan nga yung bot, kulit mo kalbo",
      "mamaya na, kausapin mo bot ko",
      "bilang ako mga 1 to 2 3 5 5 6 7 8 9 10 11 12 tapos mag on ako bot",
      "aaahh moka ka bot nga",
    ],
  },
  {
    name: "trash-talk",
    triggers: ["weak", "laro", "bubu", "sino yan"],
    index: 0,
    replies: [
      "lakas mo magsalita, tulog ka naman nung Clash",
      "pabuhat ka pa rin hanggang ngayon bro",
      "umiyak ka na lang sa gilid",
      "maingay lang sa chat pero bano sa laro",
      "brush ka muna ng ngipin bago ka mag-chat",
      "puro ka daldal, minus ka naman sa points",
      "report post ka na lang mas bagay sa'yo",
      "tulog mo na lang yan, mukhang pagod ka na",
      "tahimik ka bigla nung natalo e",
      "crying emoji yarn?",
      "'di ka nga makatama ng skill shot e",
      "delete mo na lang account mo",
      "sino tinatakot mo, sarili mo?",
      "galit na galit gustong manakit",
      "balik ka na sa tutorial mode",
      "tulong ka na lang sa gawaing bahay",
      "practice ka muna kahit kanina lang",
      "ano, tuloy mo pa yang tapang mo?",
      "maingay pero bano",
      "cry me a river na lang beh",
    ],
  },
  {
    name: "casual-comebacks",
    triggers: ["ano", "bakit", "sige"],
    index: 0,
    replies: [
      "bat ka galit? kain ka muna lugaw",
      "sorry na, 'di ka na mabiro",
      "kumain ka na ba? parang kulang ka sa lasa",
      "inhale, exhale, baka pumutok ugat mo",
      "copy paste mo pa yan dali",
      "sigaw mo pa nang malakas, 'di pa naririnig",
      "o tapos? ano award mo niyan?",
      "e di ikaw na magaling, ikaw na President",
      "chat ka lang diyan, boring din e",
      "patingin nga ng resibo bago ka magsalita",
      "sige lang, libre naman mangarap",
      "ikain mo na lang yan ng ice cream",
      "galit yarn? pa-hug nga",
      "sige, kwento mo sa pagong",
      "busy ako, kausapin mo pusa ko",
      "haha sige support kita sa mental health mo",
      "sige lang, push mo pa yan",
      "oo na lang para matapos na",
      "breath in, breath out lang idol",
      "wala akong barya pambili ng pake mo",
    ],
  },
  {
    name: "one-liners",
    triggers: ["k", "lol", "haha", "o"],
    index: 0,
    replies: [
      "k",
      "wew",
      "okay po master",
      "lods panalo ka na",
      "weep weep",
      "teh kalma",
      "yawn... tapos na?",
      "nod nod",
      "sana okay ka lang",
      "next topic please",
      "drama mo",
      "hahahaha sige na nga",
      "ay wow",
      "grabe siya oh",
      "wala man lang substance",
    ],
  },
  {
    name: "deflections",
    triggers: ["sino", "sino ka", "saan"],
    index: 0,
    replies: [
      "tanong mo sa kapitbahay niyo",
      "search mo sa Google, baka alam nila",
      "sekretong malupit, walang nakakaalam",
      "tanong mo sa lolo mong paro-paro",
      "hanapin mo sa outer space",
      "ewan ko sa'yo, busy ako mag-meryenda",
      "wait lang, busy pa ko magpalamig ng tubig",
      "ask me if I care (spoilers: I don't)",
      "PM mo sa kapitan niyo",
      "bukas ko na sasagutin, gabi na",
      "i-consult mo muna sa barangay",
      "bulong mo sa hangin",
      "tingin ka sa likod mo",
      "tanong mo sa star",
      "basta ako, kumakain ng lumpia ngayon",
    ],
  },
];

/**
 * Checks a lowercased message body against all groups and returns the next
 * cycled reply from the first matching group, or null if nothing matches.
 */
function getTriggerReply(rawText) {
  if (!rawText) return null;
  const text = rawText.toLowerCase();

  for (const group of groups) {
    const hit = group.triggers.some((trigger) => {
      if (trigger.includes(" ")) {
        // multi-word trigger: plain substring match
        return text.includes(trigger);
      }
      // single-word trigger: whole-word match only, so "sige" doesn't
      // fire inside "pasigenio" etc.
      const wordBoundary = new RegExp(`\\b${escapeRegExp(trigger)}\\b`, "i");
      return wordBoundary.test(text);
    });

    if (hit) {
      const reply = group.replies[group.index];
      group.index = (group.index + 1) % group.replies.length;
      return reply;
    }
  }

  return null;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { getTriggerReply, groups };
