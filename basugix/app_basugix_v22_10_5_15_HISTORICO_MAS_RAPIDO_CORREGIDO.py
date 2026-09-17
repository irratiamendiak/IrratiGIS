import math, os, sqlite3, json, logging
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Optional
import httpx, jwt
from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from jinja2 import Environment, FileSystemLoader, select_autoescape
import uvicorn
from fwi import calculate, danger_level
