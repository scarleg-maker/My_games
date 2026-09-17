import json

with open("cards_dsbb.json", encoding="utf-8") as f:
    cards = json.load(f)

for c in cards:
    c["id"] = c["id"] + "_dsbb"

with open("cards_dsbb.json", "w", encoding="utf-8") as f:
    json.dump(cards, f, ensure_ascii=False, indent=2)

print("Terminé !")