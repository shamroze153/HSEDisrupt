import streamlit as st
import pandas as pd
import gspread
from google.oauth2.service_account import Credentials
import qrcode
from io import BytesIO
import json
import os
import re
import secrets as pysecrets
from datetime import datetime
import plotly.express as px
from streamlit_autorefresh import st_autorefresh

st.set_page_config(page_title="HSE Emergency Alert System", layout="wide", page_icon="🚨")

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
INCIDENTS_SHEET = "Incidents"
LOCATIONS_SHEET = "Locations"

# Incidents columns (1-indexed, must match Code.gs)
COL_STATUS = 9
COL_ACK_BY = 12
COL_ACK_AT = 13
COL_RESOLVED_BY = 14
COL_RESOLVED_AT = 15


def load_config():
    try:
        sheet_key = st.secrets["SHEET_KEY"]
        script_url = st.secrets["SCRIPT_URL"]
        creds_json = st.secrets["GOOGLE_SERVICE_ACCOUNT_JSON"]
    except Exception:
        from dotenv import load_dotenv
        load_dotenv()
        sheet_key = os.getenv("SHEET_KEY")
        script_url = os.getenv("SCRIPT_URL")
        creds_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    return sheet_key, script_url, creds_json


SHEET_KEY, SCRIPT_URL, CREDS_JSON = load_config()


@st.cache_resource
def get_client():
    info = json.loads(CREDS_JSON)
    creds = Credentials.from_service_account_info(info, scopes=SCOPES)
    return gspread.authorize(creds)


def get_spreadsheet():
    return get_client().open_by_key(SHEET_KEY)


def get_ws(name):
    return get_spreadsheet().worksheet(name)


@st.cache_data(ttl=10)
def load_df(name):
    records = get_ws(name).get_all_records()
    return pd.DataFrame(records)


def slugify(name):
    s = re.sub(r"[^a-zA-Z0-9]+", "-", name.strip().lower()).strip("-")
    return s[:24] if s else "loc"


def build_qr_url(loc_id, loc_name):
    from urllib.parse import quote
    return f"{SCRIPT_URL}?loc={loc_id}&name={quote(loc_name)}"


def make_qr_png(url):
    qr = qrcode.QRCode(border=2, box_size=8)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def mark_status(incident_id, status, actor="dashboard"):
    ws = get_ws(INCIDENTS_SHEET)
    cell = ws.find(str(incident_id))
    if cell is None:
        st.error("Incident not found (it may have been edited elsewhere).")
        return
    row = cell.row
    ws.update_cell(row, COL_STATUS, status)
    now = datetime.now().isoformat(timespec="seconds")
    if status == "Acknowledged":
        ws.update_cell(row, COL_ACK_BY, actor)
        ws.update_cell(row, COL_ACK_AT, now)
    elif status == "Resolved":
        ws.update_cell(row, COL_RESOLVED_BY, actor)
        ws.update_cell(row, COL_RESOLVED_AT, now)
    st.cache_data.clear()


st.markdown("""
<div style="background: linear-gradient(90deg, #1a3c34, #2d5a4f); border-radius: 14px; padding: 22px 28px; margin-bottom: 16px;">
  <p style="color: #fff; font-size: 24px; font-weight: 700; margin: 0;">HSE Emergency Alert System</p>
  <p style="color: #d0e0da; font-size: 13px; margin: 4px 0 0;">QR-based incident reporting — live dashboard and location manager</p>
</div>
""", unsafe_allow_html=True)

tab_live, tab_locations = st.tabs(["Live incidents", "Manage locations"])

# ===================== LIVE INCIDENTS =====================
with tab_live:
    try:
        df = load_df(INCIDENTS_SHEET)
    except Exception as e:
        st.error(f"Could not load Incidents sheet: {e}")
        df = pd.DataFrame()

    if df.empty:
        st.info("No incidents logged yet.")
    else:
        df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
        open_df = df[df["status"] == "Open"]
        ack_df = df[df["status"] == "Acknowledged"]
        resolved_df = df[df["status"] == "Resolved"]

        if len(ack_df) > 0 and "acknowledged_at" in df.columns:
            ack_times = pd.to_datetime(ack_df["acknowledged_at"], errors="coerce")
            response_minutes = (ack_times - ack_df["timestamp"]).dt.total_seconds() / 60
            avg_response = response_minutes.mean()
        else:
            avg_response = None

        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Open now", len(open_df))
        c2.metric("Acknowledged", len(ack_df))
        c3.metric("Resolved (all time)", len(resolved_df))
        c4.metric("Avg response time", f"{avg_response:.1f} min" if avg_response is not None and not pd.isna(avg_response) else "—")

        st.divider()

        active = pd.concat([open_df, ack_df]).sort_values("timestamp", ascending=False)
        if active.empty:
            st.success("No active incidents right now.")
        else:
            st.subheader("Active incidents")
            for _, row in active.iterrows():
                status = row["status"]
                badge_color = "#A32D2D" if status == "Open" else "#854F0B"
                cols = st.columns([3, 2, 2, 2, 2])
                cols[0].markdown(f"**{row.get('location_name', '—')}**  \n{row.get('note', '') or '—'}")
                cols[1].markdown(f"<span style='color:{badge_color};font-weight:600'>{row['type']} · {status}</span>", unsafe_allow_html=True)
                cols[2].write(row["timestamp"].strftime("%d-%b %H:%M") if pd.notna(row["timestamp"]) else "—")
                if status == "Open":
                    if cols[3].button("Acknowledge", key=f"ack_{row['id']}"):
                        mark_status(row["id"], "Acknowledged")
                        st.rerun()
                else:
                    cols[3].write("Acknowledged")
                if cols[4].button("Resolve", key=f"res_{row['id']}"):
                    mark_status(row["id"], "Resolved")
                    st.rerun()

        st.divider()
        col_a, col_b = st.columns(2)
        with col_a:
            st.subheader("Incidents by type")
            by_type = df["type"].value_counts().reset_index()
            by_type.columns = ["type", "count"]
            fig1 = px.bar(by_type, x="type", y="count")
            st.plotly_chart(fig1, use_container_width=True)
        with col_b:
            st.subheader("Incidents by location")
            by_loc = df["location_name"].value_counts().reset_index()
            by_loc.columns = ["location", "count"]
            fig2 = px.bar(by_loc, x="location", y="count")
            st.plotly_chart(fig2, use_container_width=True)

        with st.expander("All incidents (raw log)"):
            st.dataframe(df.sort_values("timestamp", ascending=False), use_container_width=True)
            st.download_button("Download CSV", df.to_csv(index=False).encode("utf-8"), "incidents.csv", "text/csv")

# ===================== MANAGE LOCATIONS =====================
with tab_locations:
    st.subheader("Add a new location")
    with st.form("add_location"):
        name = st.text_input("Location name (e.g. 'Block B, Lift Lobby, 3rd Floor')")
        building = st.text_input("Building / campus")
        floor = st.text_input("Floor (optional)")
        submitted = st.form_submit_button("Generate QR code")

    if submitted:
        if not name.strip():
            st.error("Location name is required.")
        else:
            loc_id = f"{slugify(name)}-{pysecrets.token_hex(2)}"
            now = datetime.now().isoformat(timespec="seconds")
            try:
                get_ws(LOCATIONS_SHEET).append_row([loc_id, name, building, floor, now])
                st.cache_data.clear()
                url = build_qr_url(loc_id, name)
                png = make_qr_png(url)
                st.success(f"Location added: {name}")
                st.image(png, width=220)
                st.download_button("Download QR (PNG)", png, f"qr-{loc_id}.png", "image/png")
                st.caption(url)
            except Exception as e:
                st.error(f"Could not save location: {e}")

    st.divider()
    st.subheader("Existing locations")
    try:
        loc_df = load_df(LOCATIONS_SHEET)
    except Exception as e:
        st.error(f"Could not load Locations sheet: {e}")
        loc_df = pd.DataFrame()

    if loc_df.empty:
        st.info("No locations added yet.")
    else:
        for _, row in loc_df.iterrows():
            cols = st.columns([3, 2, 1])
            cols[0].markdown(f"**{row['name']}**  \n{row.get('building', '')} {row.get('floor', '')}")
            cols[1].caption(row["id"])
            url = build_qr_url(row["id"], row["name"])
            png = make_qr_png(url)
            cols[2].download_button("QR", png, f"qr-{row['id']}.png", "image/png", key=f"dl_{row['id']}")
