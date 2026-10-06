# FinitiOnline - שליחת מייל ב-SMTP גולמי (smtplib, ללא ספריות), אותו דפוס כמו ב-Planner.
# מקבל JSON ב-stdin:
#   { smtp_host, smtp_port, from_email, from_name, to_emails: [..], subject, body_html,
#     smtp_user?, smtp_password? }
import sys
import json
import smtplib
from email.header import Header
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
data = json.loads(sys.stdin.read())

from_email = data["from_email"]
from_name = data.get("from_name") or ""
to_emails = data.get("to_emails") or []
if isinstance(to_emails, str):
    to_emails = [a.strip() for a in to_emails.split(",") if a.strip()]
if not to_emails:
    print("ERROR: no recipients")
    sys.exit(1)

message = MIMEMultipart("alternative")
message["From"] = formataddr((str(Header(from_name, "utf-8")), from_email)) if from_name else from_email
message["To"] = ", ".join(to_emails)
message["Subject"] = Header(data["subject"], "utf-8")
message.attach(MIMEText(data["body_html"], "html", "utf-8"))

host = data.get("smtp_host", "localhost")
port = int(data.get("smtp_port", 25))

with smtplib.SMTP(host, port, timeout=20) as server:
    if data.get("smtp_user") and data.get("smtp_password"):
        server.starttls()
        server.login(data["smtp_user"], data["smtp_password"])
    server.sendmail(from_email, to_emails, message.as_string())

print("OK")
