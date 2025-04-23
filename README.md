# Islamic Times Web App

A minimal, sleek, and responsive Flask application that showcases the [`islamic_times`](https://github.com/hassantahan/islamic_times/) python library.

## Features

- **Precise Prayer Time Calculations** with manual override via city/address search or GPS.
- **Advanced settings** for selecting calculation methods (MWL, ISNA, Egypt, Makkah, Karachi, Tehran, Jafari) or custom angles.

## Future Improvements

- Display islamic date
- Display astronomical details
- Webpage for new moon crescent visibility maps 

## Tech Stack

- **Backend**: Python, Flask, `islamic_times`, `timezonefinder`, Gunicorn
- **Frontend**: Vanilla JavaScript, TailwindCSS (via CDN), OpenStreetMap

## Prerequisites

- Python 3.9+
- `pip` package manager
- (Optional) `node` and `npm` if customizing Tailwind locally

## Installation

1. Clone the repository:
    ```bash
    git clone https://github.com/<your-username>/prayer-times.git
    cd prayer-times
    ```

2. Create and activate a virtual environment:
    ```bash
    python3 -m venv venv
    source venv/bin/activate  # Linux/macOS
    venv\Scripts\activate   # Windows
    ```

3. Install Python dependencies:
    ```bash
    pip install -r requirements.txt
    ```

4. (Optional) Install front-end dependencies if you plan to build Tailwind locally:
    ```bash
    npm install
    # then build your CSS, e.g.:
    npm run build:css
    ```

## Running Locally

Start the Flask development server:

```bash
export FLASK_APP=app.py
export FLASK_ENV=development
flask run
```

Or simply:

```bash
python app.py
```

Then open your browser at `http://localhost:5000`.

## Deployment

### Using Gunicorn + Nginx

```bash
# Install Gunicorn if not already
pip install gunicorn

# Run with 3 workers binding to port 8000
gunicorn --workers 3 --bind 0.0.0.0:8000 app:app
```

You can put an Nginx reverse proxy in front to serve static files and handle HTTPS.

### Platform-as-a-Service

- **Render.com**, **Heroku**, or **Railway.app**: Connect your GitHub repository, set the start command to `gunicorn app:app`, and deploy.

## Configuration

- No additional environment variables are required for basic usage.
- Geocoding uses OpenStreetMap’s public Nominatim API (rate-limited).

## Contributing

Contributions welcome! Please open issues or pull requests for bug fixes and enhancements.

## License

This project is licensed under the CC-BY-NC License. See `LICENSE` for details.
