const groups = [
  {
    name: "jaiden",
    triggers: ["jaiden"],
    index: 0,
    replies: [
      "jaiden na naman",
      "jaiden, yung mukhang paa ba?",
      "la, jaiden ulit",
      "kelan kaya map-phase out kagaya ni jaiden?",
      "si jaiden nakita ko nakatambay sa grinder e",
      "jaiden and his broke boys era",
      "pag broke jaiden, mamakla ka",
      "jaiden mukhang nahulugan langka e",
      "tangina mo, pake ko sa opinion mo",
      "kelan kaya tatanggaling freedom of speech netong gago na to?",
      "onga e, mukha kang kumakain pwet",
      "todo sabat, akala mo naman may arit e anghit dala mo",
      "iyak si gago",
      "pake ko nga?",
      "turo mo sino nag tanong",
      "bilang ka muna",
      "moka ka libro",
      "moka ka tiles",
      "moka ka jaiden, aahhh si jaiden ka nga pala hahahaah malas mo naman",
      "moka ka bahay",
      "moka ka semento",
      "moka ka aspalto",
      "moka ka braided na bulbul",
      "moka ka tanga",
      "moka ka gago",
      "dami ebas ni jaiden tol, di nga ako nag reklamo nung mukhang pinagtagpi tagpi na napkin bahay nila",
      "meta sa ml ngayon: jaiden",
      "naka full def si jaiden erp, pero tinagos lang nung regla ng mama niya",
      "what if erp jaiden, at mga tol, tirahin ko mama neto?",
      "moka ka loonie",
      "tito mong daga, mukhang nilaga",
      "medyo naiiyak na si jaiden, sadly wala akong pake",
      "jaiden, bakit yung mama mo mukhang pinaglihi sa paniki?",
      "moka ka beetle juice",
      "mapagdamot pag dating sa ate si erp jaiden, eh kamukha naman ni wally ate niya",
      "si jaiden spotted namamakla",
      "yung tipong nag work out ka para lumaki katawan, eh kaso naging kamukha mo si jaiden",
    ],
  },
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
      "deeptalk with jaiden and friends habang kinakantot ko sa backseat ate niya",
      "on mo lola mong bot",
      "bot ko nga pala, nice to meet you raw",
      "kuha lang ako plato, tapos kain tayo kasama bot ko",
      "may bot pala?",
      "asan nga yung bot, kulit mo kalbo",
      "mamaya na, kausapin mo bot ko",
      "bilang ako mga 1 to 2 3 5 5 6 7 8 9 10 11 12 tapos mag on ako bot",
      "aaahh moka ka bot nga"
    ]
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
      "cry me a river na lang beh"
    ]
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
      "wala akong barya pambili ng pake mo"
    ]
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
      "wala man lang substance"
    ]
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
      "basta ako, kumakain ng lumpia ngayon"
    ]
  }
];

function getTriggerReply(rawText) {
  if (!rawText) return null;

  const text = rawText.toLowerCase();

  for (const group of groups) {
    const hit = group.triggers.some((trigger) => {
      if (trigger.includes(" ")) {
        return text.includes(trigger);
      }

      const wordBoundary = new RegExp(
        `\\b${escapeRegExp(trigger)}\\b`,
        "i"
      );

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

module.exports = {
  getTriggerReply,
  groups
};
