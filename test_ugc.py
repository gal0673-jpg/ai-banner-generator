import requests
import time
import sys

BASE_URL = "http://127.0.0.1:8888"
EMAIL = "gal0673@gmail.com" # החלף למייל שאיתו אתה מתחבר למערכת
PASSWORD = "Se1_f0DgD2OkrhfshKGnXmx2junP5VgQ" # החלף לסיסמה שלך!

def test_ugc_generation():
    print("🔑 מתחבר למערכת...")
    
    # שימוש ב-Session שומר אוטומטית את העוגיות (Cookies) של ההתחברות
    session = requests.Session()
    
    # 1. התחברות
    login_data = {
        "username": EMAIL,
        "password": PASSWORD
    }
    
    try:
        login_res = session.post(f"{BASE_URL}/auth/login", data=login_data)
        login_res.raise_for_status()
        print("✅ התחברות בוצעה בהצלחה!")
    except Exception as e:
        print(f"❌ שגיאת התחברות (בדוק אימייל וסיסמה): {e}")
        if 'login_res' in locals(): print(login_res.text)
        sys.exit(1)

    print("\n🚀 מתחיל טסט יצירת סרטון UGC...")
    
    # 2. שליחת בקשה לייצור
    # D-ID מורידים את התמונה מה-URL שלך — חייב להחזיר HTTP 200 ותמונה אמיתית.
    # הקישור Example_of_a_portrait.jpg בוויקימדיה מחזיר 404 (הקובץ לא קיים), ואז D-ID: "Unsupported file url".
    # alice.jpg הוא נכס רשמי של D-ID (פורטרט נשי) — יציב לבדיקות.
    payload = {
        "url": "https://www.tsite.co.il",
        "brief": "תדגיש שהמערכת מהירה מאוד וקלה לשימוש ללא תוספים.",
        "provider": "d-id",
        "avatar_id": "https://d-id-public-bucket.s3.us-west-2.amazonaws.com/alice.jpg",
        "video_length": "15s",
    }
    
    try:
        # שים לב שאנחנו משתמשים ב-session.post ולא ב-requests.post
        res = session.post(f"{BASE_URL}/generate-ugc", json=payload)
        res.raise_for_status()
        task_id = res.json().get("task_id")
        print(f"✅ משימה נוצרה בהצלחה! Task ID: {task_id}")
    except Exception as e:
        print(f"❌ שגיאה ביצירת המשימה: {e}")
        if 'res' in locals(): print(res.text)
        sys.exit(1)

    # 3. דגימה (Polling) של הסטטוס
    print("⏳ ממתין לסיום התהליך (זה עשוי לקחת 2-4 דקות)...")
    while True:
        try:
            status_res = session.get(f"{BASE_URL}/status/{task_id}")
            status_res.raise_for_status()
            data = status_res.json()
            
            ugc_status = data.get("ugc_status")
            print(f"[{time.strftime('%H:%M:%S')}] סטטוס נוכחי: {ugc_status}")
            
            if ugc_status == "rendering_captions":
                print(f"[{time.strftime('%H:%M:%S')}] ⏳ Remotion מרנדר כתוביות... (עד 10 דקות)")

            if ugc_status == "completed":
                print("\n🎉 הסרטון מוכן!!!")
                print("==================================================")

                final   = data.get("ugc_final_video_url")
                comp    = data.get("ugc_composited_video_url")
                raw     = data.get("ugc_raw_video_url")
                note    = data.get("ugc_composite_note")

                if final:
                    print(f"✅ וידאו סופי עם כתוביות (Remotion):\n   {final}")
                else:
                    print("⚠️  וידאו Remotion לא נוצר (ראה הערה למטה).")

                if comp:
                    print(f"🎬 וידאו FFmpeg (crop-to-fill):\n   {comp}")

                print(f"📹 וידאו גלמי (HeyGen/D-ID):\n   {raw}")

                if note:
                    print(f"\n🔍 הערת אבחון (ugc_composite_note):\n   {note}")

                print("==================================================")
                print("תסריט ה-AI שנוצר:")
                script = data.get("ugc_script") or {}
                for s in script.get("scenes", []):
                    print(f"  סצנה {s.get('scene_number')}: [{s.get('visual_layout')}]")
                    print(f"    מדובר: {s.get('spoken_text', '')[:80]}")
                    print(f"    על המסך: {s.get('on_screen_text', '')}")
                break
            elif ugc_status == "failed" or data.get("status") == "failed":
                print(f"\n❌ המשימה נכשלה!")
                print(f"שגיאה: {data.get('ugc_error') or data.get('error')}")
                note = data.get("ugc_composite_note")
                if note:
                    print(f"הערת אבחון: {note}")
                break
                
        except Exception as e:
            print(f"⚠️ שגיאה בבדיקת הסטטוס: {e}")
            
        time.sleep(10)

if __name__ == "__main__":
    test_ugc_generation()