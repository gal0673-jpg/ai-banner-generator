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
            
            if ugc_status == "completed":
                print("\n🎉 הסרטון מוכן!!!")
                print("==================================================")
                print("וידאו גלמי:")
                print(data.get("ugc_raw_video_url"))
                print("==================================================")
                print("תסריט ה-AI שנוצר:")
                print(data.get("ugc_script"))
                break
            elif ugc_status == "failed" or data.get("status") == "failed":
                print(f"\n❌ המשימה נכשלה!")
                print(f"שגיאה: {data.get('ugc_error') or data.get('error')}")
                break
                
        except Exception as e:
            print(f"⚠️ שגיאה בבדיקת הסטטוס: {e}")
            
        time.sleep(10)

if __name__ == "__main__":
    test_ugc_generation()