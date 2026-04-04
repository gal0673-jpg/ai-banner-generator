"""
Read scraped_content.txt and ask GPT-4o for social banner copy (JSON).
Save banner_data.json, generate DALL-E 3 background, save background.png.
Requires: pip install openai requests
Set OPENAI_API_KEY in the environment (never commit keys to the repo).
"""

import json
import os
import sys
from pathlib import Path

import requests
from openai import OpenAI

SCRAPED_PATH = Path(__file__).resolve().parent / "scraped_content.txt"
BANNER_JSON_PATH = Path(__file__).resolve().parent / "banner_data.json"
BACKGROUND_PNG_PATH = Path(__file__).resolve().parent / "background.png"

SYSTEM_PROMPT = (
    "You are an expert marketing copywriter. Analyze the provided text from a "
    "business website. Create copy for a social media banner. Output ONLY a valid "
    "JSON object with 3 keys: headline (a catchy short Hebrew title, max 6 words), "
    "cta (call to action in Hebrew, max 4 words), and image_prompt (a detailed prompt "
    "in English for an AI image generator to create a professional background image "
    "WITHOUT any text, matching the business vibe)."
)


def main() -> None:
    if not os.environ.get("OPENAI_API_KEY"):
        print(
            "Error: Set OPENAI_API_KEY (e.g. in PowerShell: "
            "$env:OPENAI_API_KEY='your-key-here').",
            file=sys.stderr,
        )
        sys.exit(1)

    if not SCRAPED_PATH.is_file():
        print(f"Error: {SCRAPED_PATH} not found.", file=sys.stderr)
        sys.exit(1)

    user_content = SCRAPED_PATH.read_text(encoding="utf-8")
    if not user_content.strip():
        print("Error: scraped content is empty.", file=sys.stderr)
        sys.exit(1)

    client = OpenAI()

    print("Requesting banner copy from gpt-4o…")
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        response_format={"type": "json_object"},
    )

    text = response.choices[0].message.content
    if not text:
        print("Error: Empty response from API.", file=sys.stderr)
        sys.exit(1)

    print("Parsing JSON response…")
    data = json.loads(text)

    print(f"Saving banner data to {BANNER_JSON_PATH}…")
    with BANNER_JSON_PATH.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("Generated banner JSON:")
    print(json.dumps(data, ensure_ascii=False, indent=2))

    try:
        image_prompt = data["image_prompt"]
    except KeyError:
        print("Error: JSON missing required key 'image_prompt'.", file=sys.stderr)
        sys.exit(1)

    print("Calling DALL-E 3 (1024×1024)…")
    img_response = client.images.generate(
        model="dall-e-3",
        prompt=image_prompt,
        size="1024x1024",
    )
    image_url = img_response.data[0].url
    if not image_url:
        print("Error: DALL-E response had no image URL.", file=sys.stderr)
        sys.exit(1)

    print("Downloading image from URL…")
    img_req = requests.get(image_url, timeout=120)
    img_req.raise_for_status()

    print(f"Writing {BACKGROUND_PNG_PATH}…")
    BACKGROUND_PNG_PATH.write_bytes(img_req.content)
    print("Done.")


if __name__ == "__main__":
    main()
