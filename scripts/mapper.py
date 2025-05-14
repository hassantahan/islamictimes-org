import os, sys, tempfile, gc, psutil, argparse

import numpy as np
import geopandas as gpd
import islamic_times.astro_core as fast_astro

from time import time
from typing import List, Tuple
from datetime import timedelta, datetime
from multiprocessing import Pool, cpu_count, Process
from islamic_times.time_equations import get_islamic_month, gregorian_to_hijri

# Plotting libraries
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import matplotlib.gridspec as gridspec

from textwrap import wrap
from matplotlib.axes import Axes
from matplotlib.patches import Rectangle
from matplotlib.patheffects import Stroke, Normal

AVERAGE_LUNAR_MONTH_DAYS: int = 29.53059

CITIES_WORLD: list[str] = [
        # PACIFIC
        'Honolulu', 
        
        # NORTH AMERICA
        'Vancouver', 'Los Angeles', 'Mexico City',
        'Toronto', 'Miami', 'Washington,  D.C.',

        # SOUTH AMERICA
        'Lima', 'Bogota', 'Santiago', 'São Paulo',

        # WEST AFRICA
        'Dakar', 'Lagos',

        # EUROPE
        'Madrid', 'London', 'Vienna', 'Moscow',

        # SOUTH AFRICA
        'Cape Town', 

        # MIDDLE EAST
        'Istanbul', 'Cairo', 'Makkah', 'Tehran',

        # EAST AFRICA
        'Nairobi', 'Addis Ababa', 

        # SOUTH ASIA
        'Islamabad', 'Mumbai',

        # SOUTH EAST ASIA
        'Bangkok',  'Singapore',

        # EAST ASIA
        'Hong Kong', 'Beijing', 'Tokyo', 
        
        # AUSTRALIA
        'Sydney', 'Perth' 
    ]

CITIES_IRAN: list[str] = [
    'Tehran', 'Mashhad', 'Kerman', 'Shiraz', 'Zanjan', 
    'Ardabil', 'Isfahan', 'Gorgan', 'Tabriz', 'Semnan', 
    'Yazd', 'Rasht', 'Arak', 'Boshruyeh', 'Mehran', 'Dargaz', 
    'Chabahar', 'Zahedan', 'Birjand', 'Sanandaj', 'Ahvaz', 
    'Saravan', 'Hamadan', 'Khorramabad', 'Qomsheh', 'Ilam', 
    'Sari', 'Qazvin', 'Bandar-e-Abbas', 'Bandar-e Bushehr', 
    'Sirjan', 'Kashmar', 'Bojnurd', 'Qom', 'Urmia', 'Khvoy',
    'Yasuj'
    ]

CITIES_MIDDLE_EAST: list[str] = [
    'Istanbul', 'Khartoum', 'Cairo', 'Luxor', 'Ankara', 
    'Beirut', 'Aleppo', 'Medina', 'Makkah', 'Djibouti',
    'Sanaa', 'Irbil', 'Baghdad', 'Riyadh', 'Kuwait City',
    'Baku', 'Tehran', 'Doha', 'Dubai', 'Kerman', 'Muscat', 
    'Mashhad', 'Karachi', 'Kabul'
    ]

CITIES_NORTH_AMERICA: list[str] = [
    # Pacific
    'Honolulu',
    
    # CANADA
    'Vancouver', 'Edmonton', 'Calgary', 'Winnipeg', 'Thunder Bay', 
    'Toronto', 'Montréal', 'Halifax', 'St. John\'s',

    # UNITED STATES
    'Portland', 'San Francisco', 'Los Angeles', 'Billings', 
    'Albuquerque', 'Denver', 'Kansas City', 'Dallas', 'Houston', 
    'Minneapolis', 'Chicago', 'Orlando', 'Atlanta', 'Miami', 
    'Washington,  D.C.', 'Boston',

    # MEXICO
    'Hermosillo', 'Monterrey', 'Mexico City', 'Mérida',

    # CARIBBEAN
    'Havana', 'Kingston',
]

CITIES_EUROPE: list[str] = [
    'Lisbon', 'Dublin', 'Madrid', 'Edinburgh',
    'London', 'Barcelona', 'Paris', 'Amsterdam', 'Zürich', 
    'Oslo', 'Rome', 'København', 'Venice', 'Berlin', 
    'Vienna', 'Stockholm', 'Sarajevo', 'Warsaw', 'Athens',
    'Riga', 'Bucharest', 'Minsk', 'Istanbul', 'Kyiv',
    'Ankara', 'Moscow', 'Rostov', 'Tbilisi'
]

REGION_COORDINATES: dict[str, tuple[int, int, int, int]] = {
    'WORLD'         :   (-179, 180, -61, 61),
    'WORLD_FULL'    :   (-179, 180, -89, 90),
    'NORTH_AMERICA' :   (-170, -40, 15, 61),
    'EUROPE'        :   (-15, 50, 34, 61),
    'MIDDLE_EAST'   :   (25, 75, 10, 45),
    'IRAN'          :   (43.5, 63.5, 24.5, 40)
}

REGION_CITIES: dict[str, list[str]] = {
    'WORLD'         : CITIES_WORLD,
    'WORLD_FULL'    : CITIES_WORLD, # NOT YET SUPPORTED
    'NORTH_AMERICA' : CITIES_NORTH_AMERICA,
    'EUROPE'        : CITIES_EUROPE,
    'MIDDLE_EAST'   : CITIES_MIDDLE_EAST,
    'IRAN'          : CITIES_IRAN 
}

class Tee:
    def __init__(self, filename, log_dir="mapper_logs", mode="w+", encoding="utf-8"):
        if not os.path.exists(log_dir):
            os.makedirs(log_dir)
        self.file = open(f"{log_dir}/{filename}", mode, encoding=encoding)
        self.stdout = sys.stdout

    def write(self, message):
        self.stdout.write(message)
        self.file.write(message)

    def flush(self):
        self.stdout.flush()
        self.file.flush()

def _write_chunk_to_memmap(args):
    (
      i_chunk, chunk, lon_vals, new_moon_date, days, criterion,
      utc_offset, elev, temp, press, is_raw,
      cat_to_idx,
      vis_file, shape
    ) = args

    # reopen the memmap for read/write:
    vis_memmap = np.memmap(vis_file, dtype=(np.float32 if is_raw else np.uint8),
                           mode="r+", shape=shape)

    # do your batch compute
    L, M = np.meshgrid(chunk, lon_vals, indexing="ij")
    res_flat = fast_astro.compute_visibilities_batch(
        np.ascontiguousarray(L.ravel(), dtype=np.float64),
        np.ascontiguousarray(M.ravel(), dtype=np.float64),
        new_moon_date, days, criterion,
        utc_offset, elev, temp, press,
        "r" if is_raw else "c"
    )
    res = res_flat.reshape(chunk.size, len(lon_vals), days)

    # if in category mode, map string labels → integers
    if not is_raw:
        n_chunk = chunk.size
        nx = len(lon_vals)
        mapped = np.empty((n_chunk, nx, days), dtype=np.uint8)
        for category, idx in cat_to_idx.items():
            mask = (res == category)
            if mask.any():
                mapped[mask] = idx
        res = mapped

    # write into the right slice
    start = sum(c.size for c in VIS_LAT_CHUNKS[:i_chunk])
    vis_memmap = np.memmap(vis_file, dtype=(np.float32 if is_raw else np.uint8),
                           mode="r+", shape=shape)
    vis_memmap[start:start+n_chunk, :, :] = res
    vis_memmap.flush()

def _plot_worker(
    lon_vals, lat_vals, vis_file, shape, mode,
    shp_states_path, shp_places_path, cities,
    unique_categories, category_colors_rgba,
    start_date, amount, out_dir,
    islamic_month_name, islamic_year, criterion, region
):
    import geopandas as gpd, numpy as np, matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from shapely.geometry import Polygon
    # re-open memmap
    vis_mm = np.memmap(vis_file,
                       dtype=(np.float32 if mode=="raw" else np.uint8),
                       mode="r", shape=shape)

    # load & clip shapefiles here, in the child only
    states = gpd.read_file(shp_states_path)
    places = gpd.read_file(shp_places_path)
    places = places[places["NAME"].isin(cities)]
    places = places.loc[places.groupby("NAME")["POP_MAX"].idxmax()]

    # create clip bbox & apply
    minx, maxx, miny, maxy = REGION_COORDINATES[region]
    bbox = Polygon([(minx, miny), (maxx, miny), (maxx, maxy), (minx, maxy)])
    bbox_gdf = gpd.GeoDataFrame([1], geometry=[bbox], crs=states.crs)
    states_clip = gpd.overlay(states, bbox_gdf, how="intersection")
    places_clip = places.cx[minx:maxx, miny:maxy]

    # call your existing plot_map exactly as is,
    # passing vis_mm instead of an in-memory array
    plot_map(
        lon_vals, lat_vals, vis_mm,
        states_clip, places_clip,
        unique_categories, category_colors_rgba,
        start_date, amount, out_dir,
        islamic_month_name, islamic_year, criterion,
        amount, mode
    )

def print_ts(message: str):
    print(f"[{datetime.fromtimestamp(time()).strftime('%X %d-%m-%Y')}] {message}")

def split_lat_chunks(lat_vals, n_chunks):
    return np.array_split(lat_vals, n_chunks)

def batch_worker(lat_chunk, lon_vals, dt, days, criterion, utc_offset, elev, temp, press, mode_byte):
    lats, lons = np.meshgrid(lat_chunk, lon_vals, indexing="ij")
    lats_flat = np.ascontiguousarray(lats.ravel(),  dtype=np.float64)
    lons_flat = np.ascontiguousarray(lons.ravel(),  dtype=np.float64)
    result_flat = fast_astro.compute_visibilities_batch(lats_flat, lons_flat, dt, days, criterion,
                                                utc_offset, elev, temp, press, mode_byte)
    ny, nx = lats.shape
    return result_flat.reshape(ny, nx, days)

def compute_visibility_map_parallel(lon_vals, lat_vals, new_moon_date, days, criterion,
                                    utc_offset=0.0, elev=0.0, temp=20.0, press=101.325,
                                    mode="category", max_workers=None):
    """Compute and store (ny, nx, days) results on disk via memmap."""
    # pick dtype: raw→float32, category→uint8
    is_raw = (mode == "raw")
    dtype = np.float32 if is_raw else np.uint8

    # figure out chunking & worker count
    num_workers = cpu_count() if max_workers is None else max_workers
    num_workers = min(num_workers, len(lat_vals))
    lat_chunks = [c for c in np.array_split(lat_vals, num_workers) if c.size]

    print_ts(f"Conjunction Date: {new_moon_date.strftime('%Y-%m-%d %X')}")

    cat_to_idx = {}
    if not is_raw:
        categories, _ = get_category_colors(criterion)
        cat_to_idx = { cat: i for i, cat in enumerate(categories.keys()) }

    # create a temporary file to back our full array
    global VIS_LAT_CHUNKS
    VIS_LAT_CHUNKS = [c for c in np.array_split(lat_vals, num_workers) if c.size]

    # create the temp memmap
    vis_file = os.path.join(tempfile.gettempdir(),
                            f"vis_{os.getpid()}_{int(time())}.dat")
    shape = (len(lat_vals), len(lon_vals), days)
    dtype = np.float32 if is_raw else np.uint8
    np.memmap(vis_file, dtype=dtype, mode="w+", shape=shape)

    # build argument list
    args_list = []
    for i, chunk in enumerate(VIS_LAT_CHUNKS):
        args_list.append((
            i, chunk, lon_vals, new_moon_date, days, criterion,
            utc_offset, elev, temp, press, is_raw,
            cat_to_idx,
            vis_file, shape
        ))

    if num_workers == 1:
        for a in args_list:
            _write_chunk_to_memmap(a)
    else:
        with Pool(num_workers) as pool:
            pool.map(_write_chunk_to_memmap, args_list)

    # return both objects so callers know where the file lives
    mm = np.memmap(vis_file, dtype=dtype, mode="r", shape=shape)
    return mm, vis_file

def load_shapefiles(states_path, places_path, cities):
    states_gdf = gpd.read_file(states_path)
    places_gdf = gpd.read_file(places_path)
    places_gdf = places_gdf[places_gdf['NAME'].isin(cities)]
    places_gdf = places_gdf.loc[places_gdf.groupby('NAME')['POP_MAX'].idxmax()]
    return states_gdf, places_gdf

def clip_map(states_gdf, places_gdf, minx=-179, maxx=180, miny=-61, maxy=61):
    from shapely.geometry import Polygon
    bbox_polygon = Polygon([(minx, miny), (maxx, miny), (maxx, maxy), (minx, maxy)])
    bbox_gdf = gpd.GeoDataFrame([1], geometry=[bbox_polygon], crs=states_gdf.crs)
    states_clip = gpd.overlay(states_gdf, bbox_gdf, how='intersection')
    places_clip = places_gdf.cx[minx:maxx, miny:maxy]
    return states_clip, places_clip

def create_grid(resolution, minx=-179, maxx=180, miny=-61, maxy=61):
    lon_vals = np.linspace(minx, maxx, resolution)
    lat_vals = np.linspace(miny, maxy, resolution)
    return lon_vals, lat_vals, len(lon_vals), len(lat_vals)

def get_category_colors(visibility_type):
    import matplotlib.colors as mcolors
    categories = {
        0: {
            "Moonset before the new moon.": "#141414",
            "Moonset before sunset.": "#393a3c",
            "D: Crescent is not visible even by optical aid.": "#807f80",
            "C: Crescent is visible by optical aid only.": "#B89D18",
            "B: Crescent is visible by optical aid, and it could be seen by naked eyes.": "#74b818",
            "A: Crescent is visible by naked eyes.": "#1BB818"
        },
        1: {
            "Moonset before the new moon.": "#141414",
            "Moonset before sunset.": "#393a3c",
            "F: Not visible; below the Danjon limit.": "#807f80",
            "E: Not visible with a [conventional] telescope.": "#B81818",
            "D: Will need optical aid to find crescent.": "#e3d61b",
            "C: May need optical aid to find crescent.": "#89d518",
            "B: Visible under perfect conditions.": "#54b818",
            "A: Easily visible.": "#1bdf18",
        }
    }
    selected_categories = categories[visibility_type]
    transparent_category = list(selected_categories.keys())[2]
    colors_rgba = {k: mcolors.to_rgba(v) if k != transparent_category else (0, 0, 0, 0.1) for k, v in selected_categories.items()}
    return selected_categories, colors_rgba

def map_visibilities(visibilities_3d, category_to_index, ny, nx, amount, mode="category"):
    """
    If mode=='category', visibilities_3d is already a uint8 array of indices.
    Otherwise (raw mode) we map each q-value into category_to_index.
    """
    if mode == "category":
        # already numeric indices 0..N-1
        return visibilities_3d

    # raw mode: build a fresh integer map
    visibilities_mapped = np.zeros((ny, nx, amount), dtype=int)
    for i_lat in range(ny):
        for i_lon in range(nx):
            for i_day in range(amount):
                cat = visibilities_3d[i_lat, i_lon, i_day]
                visibilities_mapped[i_lat, i_lon, i_day] = category_to_index[cat]
    return visibilities_mapped

def signed_log_transform(x, epsilon: float):
    """Apply a signed pseudo-log transform to handle both negative and positive values."""
    return np.sign(x) * np.log1p(np.abs(x) / epsilon)

def inverse_signed_log_transform(y, epsilon: float):
    """Reverse the signed_log_transform to recover original q_value from transformed."""
    return np.sign(y) * (np.expm1(np.abs(y)) * epsilon)

def setup_color_mapping(mode, visibilities_mapped, unique_categories, category_colors_rgba):
    if mode == "raw":
        # Filter all valid values once across all days
        mask_valid = (~np.isin(visibilities_mapped, [-999, -998])) & (~np.isnan(visibilities_mapped))
        valid_data = visibilities_mapped[mask_valid]

        if valid_data.size == 0:
            raise ValueError("No valid q_values to display in raw mode.")

        # Use median of abs(q) values for epsilon
        epsilon = np.percentile(np.abs(valid_data), 50)
        epsilon = max(epsilon, 0.1)

        # Apply signed log transform to all valid values
        transformed_data = signed_log_transform(valid_data, epsilon=epsilon)

        # Global min and max for color normalization
        zmin_transformed = np.min(transformed_data)
        zmax_transformed = np.max(transformed_data)

        cmap = plt.get_cmap("viridis")
        norm = mcolors.Normalize(vmin=zmin_transformed, vmax=zmax_transformed)

        return cmap, norm, epsilon
    else:
        cmap = mcolors.ListedColormap([category_colors_rgba[cat] for cat in unique_categories])
        bounds = np.arange(len(unique_categories) + 1)
        norm = mcolors.BoundaryNorm(bounds, cmap.N)
        return cmap, norm, None

def plot_raw_map(ax, lon_vals, lat_vals, z_data_raw, cmap, epsilon, norm):
    # Create a mask for the special-case values only once.
    special_mask = np.isin(z_data_raw, [-999, -998])
    z_data = np.where(special_mask, np.nan, z_data_raw)

    # Transform valid q_values using the provided epsilon.
    z_data_transformed = signed_log_transform(z_data, epsilon=epsilon)

    # Use shared/global norm from setup_color_mapping()
    mesh = ax.pcolormesh(lon_vals, lat_vals, z_data_transformed, cmap=cmap, norm=norm, shading="auto")

    # Fill special-case areas once per value.
    for value, color in [(-999, '#141414'), (-998, '#393a3c')]:
        mask = (z_data_raw == value).astype(float)
        if np.any(mask):
            ax.contourf(lon_vals, lat_vals, mask, levels=[0.5, 1.5], colors=[color], alpha=1.0)

    # Draw contours using same norm
    valid = z_data_transformed[~np.isnan(z_data_transformed)]
    if valid.size > 0:
        contour_levels = np.linspace(norm.vmin, norm.vmax, 10)
        cs = ax.contour(lon_vals, lat_vals, z_data_transformed, levels=contour_levels,
                        colors='white', linewidths=1.2)
        fmt = {lvl: f"{inverse_signed_log_transform(lvl, epsilon=epsilon):.1f}" for lvl in cs.levels}
        ax.clabel(cs, cs.levels, fmt=fmt, inline=True, fontsize=10)

    return mesh

def plot_features(ax, states_clip, places_clip):
    states_clip.plot(ax=ax, facecolor="none", edgecolor="black", linewidth=0.65)
    places_clip.plot(ax=ax, color='violet', markersize=7)
    # For many points, consider vectorizing or batching text annotations if performance remains an issue.
    for _, row in places_clip.iterrows():
        text = ax.text(row.geometry.x + 0.05, row.geometry.y + 0.05, row['NAME'],
                       fontsize=12, color='white', ha='left', va='bottom')
        text.set_path_effects([Stroke(linewidth=2, foreground='black'), Normal()])

def create_legend(fig, gs, unique_categories, category_colors_rgba):
    legend_ax = fig.add_subplot(gs[:, 1])
    legend_ax.axis("off")

    def wrap_text(text, width=20):
        return "\n".join(wrap(text, width))

    row_height = 1.05
    for idx, category in enumerate(unique_categories):
        wrapped = wrap_text(category, width=30)
        legend_ax.add_patch(Rectangle((0, idx * row_height), 1, 1, color=category_colors_rgba[category]))
        legend_ax.text(3.2, idx * row_height + 0.5, wrapped, fontsize=12, va='center', ha='left')

    legend_ax.set_xlim(0, 2)
    legend_ax.set_ylim(0, len(unique_categories) * row_height)
    legend_ax.set_aspect("auto")

def create_scale(fig, mesh, norm):
    cbar_ax = fig.add_axes([0.88, 0.135, 0.02, 0.8])
    cbar = fig.colorbar(mesh, cax=cbar_ax)
    cbar.set_label("Q Value", fontsize=12)

    tick_values_transformed = np.linspace(norm.vmin, norm.vmax, 7)
    tick_labels = [f"{inverse_signed_log_transform(t, epsilon=2.0):.1f}" for t in tick_values_transformed]
    cbar.set_ticks(tick_values_transformed)
    cbar.set_ticklabels(tick_labels)

    # Special cases
    legend_ax: Axes = fig.add_axes([0.82, 0.04, 0.1, 0.08])  # [left, bottom, width, height]
    legend_ax.axis("off")
    special_cases = [
        ("Moonset before the new moon.", "#141414"),
        ("Moonset before sunset.", "#393a3c"),
    ]
    for i, (label_text, color) in enumerate(special_cases):
        y = 1 - i * 0.5
        legend_ax.add_patch(Rectangle((0, y - 0.3), 0.3, 0.3,
                                      facecolor=color,
                                      edgecolor="black",
                                      linewidth=1.2))
        legend_ax.text(0.4, y - 0.15, label_text, fontsize=10, va='center', ha='left', color='black')

def annotate_plot(fig, start_date, criterion, days, islamic_month_name, islamic_year):
    criterion_string = "Odeh, 2006" if criterion == 0 else "Yallop, 1997"
    plt.subplots_adjust(hspace=0.2, left=0.05, right=0.85, top=0.95, bottom=0.05)
    plt.figtext(0.15, 0.01,
                f"The New Moon (i.e. conjunction) occurs at {start_date.strftime('%Y-%m-%d %X')} UTC",
                ha="center", fontsize=12)
    plt.figtext(0.945, 0.03, f"Criterion: {criterion_string}", ha="center", fontsize=12)
    plt.figtext(0.84, 0.01,
                "CC BY-SA | Hassan Tahan | Created with the islamic_times Python library",
                ha="center", fontsize=12)
    plt.figtext(0.5, 0.98,
                f"{days}-Day New Moon Crescent Visibility Map for {islamic_month_name}, {islamic_year} A.H.",
                ha="center", fontsize=16)

def name_fig(start_date, islamic_month_name, islamic_year, criterion, mode):
    name = f"{start_date.strftime('%Y-%m-%d')} {islamic_month_name} {islamic_year}"
    name += "—Yallop" if criterion == 1 else "—Odeh"
    qual = 95 if mode == "raw" else 90
    if mode == "raw":
        name += " Gradient"
    name += ".jpg"
    return name, qual

def plot_map(lon_vals, lat_vals, visibilities_mapped, states_clip, places_clip,
             unique_categories, category_colors_rgba, start_date, amount, out_dir, 
             islamic_month_name, islamic_year, criterion, days_to_generate, mode="category"):
    # Set up the color mapping and obtain epsilon if in raw mode.
    print_ts("Plotting: Setting up colour map...")
    cmap, norm, epsilon = setup_color_mapping(mode, visibilities_mapped, unique_categories, category_colors_rgba)

    print_ts("Plotting: Adding subplots...")
    width_x, width_y = 20, 15
    dpi = 300
    fig = plt.figure(figsize=(width_x, width_y), dpi=dpi, constrained_layout=False)
    gs = gridspec.GridSpec(amount, 2, width_ratios=[50, 1], height_ratios=[2] * amount)
    axes = [fig.add_subplot(gs[i, 0]) for i in range(amount)]
    mesh = None

    # Plot each day's visibility.
    for i_day, ax in enumerate(axes):
        print_ts(f"Plotting: Plotting Day {i_day + 1} ...")
        if mode == "raw":
            z_data_raw = visibilities_mapped[:, :, i_day]
            print_ts(f"Plotting: Raw map plotting for Day {i_day + 1} ...")
            mesh = plot_raw_map(ax, lon_vals, lat_vals, z_data_raw, cmap, epsilon, norm)
        else:
            data = visibilities_mapped[:, :, i_day]
            mesh = ax.pcolormesh(lon_vals, lat_vals, data, cmap=cmap, norm=norm, shading="auto")

        print_ts(f"Plotting: Adding features for {i_day + 1} ...")
        plot_features(ax, states_clip, places_clip)
        ax.set_xlim(min(lon_vals), max(lon_vals))
        ax.set_ylim(min(lat_vals), max(lat_vals))
        ax.set_xlabel("Longitude")
        ax.set_ylabel("Latitude")
        ax.set_title(f"New Moon Visibility on {(start_date + timedelta(days=i_day)).strftime('%Y-%m-%d')} at Local Best Time")

    if mode == "category":
        print_ts("Plotting: Adding legend...")
        create_legend(fig, gs, unique_categories, category_colors_rgba)
    else:
        print_ts("Plotting: Adding scale...")
        create_scale(fig, mesh, norm)

    print_ts("Plotting: Annotating plot...")
    annotate_plot(fig, start_date, criterion, days_to_generate, islamic_month_name, islamic_year)
    name, qual = name_fig(start_date, islamic_month_name, islamic_year, criterion, mode)

    print_ts("Plotting: Saving...")
    plt.savefig(os.path.join(out_dir, name), format='jpg',
                pil_kwargs={'optimize': True, 'progressive': True, 'quality': qual})
    plt.close('all')

def plotting_loop(new_moon_date: datetime, map_params: Tuple, master_path: str = "maps/", mode: str = "category", region: str = 'WORLD', 
                  amount: int = 1, visibility_criterion: int = 0, workers: int = None):
    # Start timing for the month
    month_start_time: float = time()
    
    # Islamic Date Formatting
    islamic_date = gregorian_to_hijri(new_moon_date.year, new_moon_date.month, new_moon_date.day)
    islamic_year, islamic_month, islamic_day = islamic_date[0], islamic_date[1], islamic_date[2]
    if islamic_day > 6:
        islamic_month += 1
        if islamic_month > 12:
            islamic_month = 1
            islamic_year += 1
    islamic_month_name = get_islamic_month(islamic_month)

    # Unpack map parameters
    states_path, places_path, lon_vals, lat_vals, nx, ny, cities = map_params

    # Create path
    path = f"{master_path}{region.replace('_', ' ').title()}/{islamic_year}/"
    if not os.path.exists(path):
        print_ts(f"Creating {path}...")
        os.makedirs(path)

    # Start
    print_ts(f"===Generating map for {islamic_month_name}, {islamic_year}===")

    # Calculate
    print_ts(f"Calculating new moon crescent visibilities...")
    t1 = time()
    visibilities_mm, vis_file = compute_visibility_map_parallel(
        lon_vals, lat_vals, new_moon_date, amount,
        visibility_criterion, mode=mode, max_workers=workers
    )
    print_ts(f"Time taken: {(time() - t1):.2f}s")

    # Categorization
    print_ts(f"Getting colours for the categories...")
    t1 = time()
    categories, colors_rgba = get_category_colors(visibility_criterion)
    print_ts(f"Time taken: {(time() - t1):.2f}s")

    # Categorize
    if mode == "category":
        visibilities_mapped = visibilities_mm        # already uint8
    else:
        print_ts("Colour-mapping raw values ...")
        t1 = time()
        categories, _ = get_category_colors(visibility_criterion)
        cat2idx = {c: i for i, c in enumerate(categories.keys())}

        # raw → new uint8 memmap on disk (still tiny vs float32)
        tmp_path = os.path.join(tempfile.gettempdir(), f"cat_{os.getpid()}_{int(time())}.dat")
        visibilities_mapped = np.memmap(tmp_path, dtype=np.uint8,
                                        mode="w+", shape=visibilities_mm.shape)

        ny, nx, days = visibilities_mm.shape
        for d in range(days):
            for c, idx in cat2idx.items():
                mask = (visibilities_mm[:, :, d] == c)
                visibilities_mapped[:, :, d][mask] = idx
        visibilities_mapped.flush()
        print_ts(f"Time taken: {(time()-t1):.2f}s")

    # Plotting
    print_ts(f"Plotting...")
    t1 = time()
    p = Process(
        target=_plot_worker,
        args=(
            lon_vals, lat_vals,
            vis_file, visibilities_mm.shape, mode,
            states_path, places_path, cities,
            list(categories.keys()) if mode=="category" else [],
            colors_rgba if mode=="category" else {},
            new_moon_date, amount, path,
            islamic_month_name, islamic_year, visibility_criterion, region
        )
    )
    p.start()
    p.join()
    print_ts(f"Time taken: {(time() - t1):.2f}s")

    # ===== CLEAN-UP =====
    del visibilities_mm
    gc.collect()
    print_ts(f"RSS after clean-up: {psutil.Process(os.getpid()).memory_info().rss // (1024*1024)} MB")

    # Finished
    print_ts(f"===Map for {islamic_month_name}, {islamic_year} Complete===")
    print_ts(f"Time to generate map for {islamic_month_name}, {islamic_year}: {(time() - month_start_time):.2f}s")

def main(today: datetime = datetime.now(), master_path: str = "maps/", total_months: int = 1, map_region: str = "WORLD", 
         map_mode: str = "category", resolution: int = 300, days_to_generate: int = 3, criterion: int = 1, save_logs: bool = False,
         max_workers: int = None):
    
    map_region = map_region.upper()
    if save_logs:
        sys.stdout = Tee(f"mapper_{datetime.fromtimestamp(time()).strftime('%Y-%m-%d_%H%M%S')}.log")
    start_time: float = time()

    # Select region 
    cities: List[str] = REGION_CITIES[map_region]
    coords: Tuple[int, int, int, int] = REGION_COORDINATES[map_region]

    states_path, places_path = "scripts/map_shp_files/combined_polygons.shp", "scripts/map_shp_files/combined_points.shp"

    print_ts(f"Creating map grid...")
    t1 = time()
    lon_vals, lat_vals, nx, ny = create_grid(resolution, minx=coords[0], maxx=coords[1], miny=coords[2], maxy=coords[3])
    print_ts(f"Time taken: {(time() - t1):.2f}s")

    for month in range(total_months):
        new_moon_date: datetime = fast_astro.next_phases_of_moon_utc(today + timedelta(days=month * AVERAGE_LUNAR_MONTH_DAYS))[0]

        plotting_loop(new_moon_date, map_params=(states_path, places_path, lon_vals, lat_vals, nx, ny, cities), master_path=master_path, region=map_region, amount=days_to_generate, 
                      visibility_criterion=criterion, mode=map_mode, workers=max_workers)

    print_ts(f"~~~ --- === Total time taken: {(time() - start_time):.2f}s === --- ~~~")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate new-moon visibility map")
    parser.add_argument("--today",           type=str,   default=None, help="ISO datetime for month/year (e.g. 2025-01-01T00:00:00)")
    parser.add_argument("--master_path",     type=str,   default="maps/", help="Directory where maps/… gets written")
    parser.add_argument("--total_months",    type=int,   default=1)
    parser.add_argument("--map_region",      type=str,   default="WORLD")
    parser.add_argument("--map_mode",        type=str,   default="category", choices=("raw","category"),)
    parser.add_argument("--resolution",      type=int,   default=300)
    parser.add_argument("--days_to_generate",type=int,   default=3)
    parser.add_argument("--criterion",       type=int,   default=1, choices=(0,1))
    parser.add_argument("--save_logs",       action="store_true")
    parser.add_argument("--max_workers",     type=int,   default=None, help="Max parallel processes (default = cpu_count())")

    args = parser.parse_args()

    # parse the "today" flag
    if args.today:
        today_dt = datetime.fromisoformat(args.today)
    else:
        today_dt = datetime.now()

    main(
        today = today_dt,
        master_path         = args.master_path,
        total_months        = args.total_months,
        map_region          = args.map_region,
        map_mode            = args.map_mode,
        resolution          = args.resolution,
        days_to_generate    = args.days_to_generate,
        criterion           = args.criterion,
        save_logs           = args.save_logs,
        max_workers         = args.max_workers
    )