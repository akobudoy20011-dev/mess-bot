[
  {
    "id": "incident_441",
    "title": "CONTAINMENT FAILURE 441",
    "mode": "incident",
    "intro": "Laboratory 3 lost power for 47 seconds. When emergency lights returned, one containment chamber was open and three logs had been altered.",
    "choices": {
      "logs": "The access log shows a maintenance override issued from Terminal 6 at 02:14.",
      "lab3": "Laboratory 3 contains claw marks, a broken sensor, and a cooling unit running at maximum.",
      "security": "Security footage shows no person entering the chamber during the outage.",
      "terminal": "Terminal 6 was physically disconnected from the network before the outage."
    },
    "answer": "lab3",
    "explanation": "The chamber did not need a person to open it. The cooling failure disabled the containment system, while the altered logs were planted to suggest a human breach.",
    "reward": 900,
    "xp": 190,
    "perfectBonus": 450
  },
  {
    "id": "incident_blackout",
    "title": "BLACKOUT PROTOCOL",
    "mode": "incident",
    "intro": "A research station loses power for exactly ninety seconds while a sealed sample disappears.",
    "choices": {
      "generator": "The generator log shows a manual shutdown.",
      "sample": "The sample container is still cold and shows no breakage.",
      "camera": "All cameras remain online during the blackout.",
      "coolant": "The coolant system never lost power."
    },
    "answer": "generator",
    "explanation": "The manual generator shutdown created the outage while preserving the sample through the independent coolant system.",
    "reward": 900,
    "xp": 190,
    "perfectBonus": 450
  },
  {
    "id": "incident_echo",
    "title": "ECHO SIGNAL",
    "mode": "incident",
    "intro": "A deep-space probe sends a signal that appears to come from its own future telemetry.",
    "choices": {
      "signal": "The signal contains a timestamp twelve hours ahead.",
      "antenna": "The antenna was rotated 4 degrees before transmission.",
      "memory": "The probe memory contains no matching event.",
      "relay": "A nearby relay station has a clock drift of exactly twelve hours."
    },
    "answer": "relay",
    "explanation": "The relay clock error explains the apparent future timestamp; the anomaly is in the relay metadata.",
    "reward": 880,
    "xp": 185,
    "perfectBonus": 440
  },
  {
    "id": "incident_red_lab",
    "title": "RED LAB",
    "mode": "incident",
    "intro": "A laboratory door opens without a badge scan during a containment drill.",
    "choices": {
      "door": "The door controller logs a mechanical override.",
      "badge": "No employee badge is recorded.",
      "floor": "A heavy equipment cart is parked against the emergency release panel.",
      "drone": "A maintenance drone was active in the corridor."
    },
    "answer": "drone",
    "explanation": "The maintenance drone triggered the mechanical release while navigating around the cart.",
    "reward": 920,
    "xp": 195,
    "perfectBonus": 460
  },
  {
    "id": "incident_signal_9",
    "title": "SIGNAL NINE",
    "mode": "incident",
    "intro": "A facility receives nine identical distress calls from different rooms at the same time.",
    "choices": {
      "network": "All calls share one network packet signature.",
      "rooms": "The rooms have independent communication units.",
      "server": "The central server restarted 30 seconds before the calls.",
      "microphone": "Room microphones were muted during the event."
    },
    "answer": "server",
    "explanation": "The simultaneous duplicate calls originated from the central server restart rather than nine independent emergencies.",
    "reward": 860,
    "xp": 180,
    "perfectBonus": 430
  },
  {
    "id": "incident_ice_core",
    "title": "ICE CORE",
    "mode": "incident",
    "intro": "A sealed ice sample begins melting despite the chamber reporting stable temperature.",
    "choices": {
      "sensor": "The temperature sensor is reading a constant value.",
      "door": "The chamber door was opened once for 12 seconds.",
      "seal": "The sample seal is intact.",
      "coolant": "Coolant pressure dropped sharply during the opening."
    },
    "answer": "coolant",
    "explanation": "The pressure drop indicates the cooling system failed to recover after the brief door opening.",
    "reward": 890,
    "xp": 185,
    "perfectBonus": 445
  },
  {
    "id": "incident_orbit",
    "title": "ORBITAL DRIFT",
    "mode": "incident",
    "intro": "A satellite begins drifting from its planned orbit without any recorded command.",
    "choices": {
      "thruster": "The thruster fired for 1.8 seconds.",
      "command": "No command was sent from mission control.",
      "solar": "Solar activity increased sharply that hour.",
      "antenna": "The antenna remained correctly aligned."
    },
    "answer": "thruster",
    "explanation": "The recorded thruster firing is the direct cause of the drift; the unresolved question is why it fired.",
    "reward": 940,
    "xp": 200,
    "perfectBonus": 470
  },
  {
    "id": "incident_quarantine",
    "title": "QUARANTINE 7",
    "mode": "incident",
    "intro": "A quarantine door reports being opened from inside while the room is empty.",
    "choices": {
      "sensor": "The pressure sensor shows a rapid change.",
      "camera": "The camera sees an empty room.",
      "vent": "The ventilation system switched to emergency mode.",
      "lock": "The lock actuator never received an unlock command."
    },
    "answer": "vent",
    "explanation": "Emergency ventilation changed the pressure enough to trigger the door sensor without an actual unlock.",
    "reward": 870,
    "xp": 180,
    "perfectBonus": 435
  },
  {
    "id": "incident_archive",
    "title": "THE SILENT ARCHIVE",
    "mode": "incident",
    "intro": "Digital research files disappear while every access log remains clean.",
    "choices": {
      "backup": "The nightly backup contains the files.",
      "storage": "The storage array reports no deletion event.",
      "sync": "A synchronization job ran twice within one minute.",
      "firewall": "No external connection was recorded."
    },
    "answer": "sync",
    "explanation": "The duplicated synchronization job caused the files to be replaced by an incomplete mirrored state.",
    "reward": 910,
    "xp": 190,
    "perfectBonus": 455
  }
]
