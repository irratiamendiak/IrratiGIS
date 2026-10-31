import importlib.util
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

SCRIPT=Path(__file__).parents[1]/"audit_dem_coverage_and_seams.py"
spec=importlib.util.spec_from_file_location("audit_dem",SCRIPT)
module=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=module
spec.loader.exec_module(module)


def write_dem(path, arr, x=0):
    with rasterio.open(path,"w",driver="GTiff",width=arr.shape[1],height=arr.shape[0],
        count=1,dtype="float32",crs="EPSG:25830",
        transform=from_origin(x,arr.shape[0],1,1),nodata=-9999) as dst:
        dst.write(arr.astype("float32"),1)


def test_coverage_counts_each_cell_once_and_detects_nodata(tmp_path):
    p=tmp_path/"mosaic.tif"
    arr=np.ones((4,5),dtype="float32")
    arr[1,2]=-9999
    write_dem(p,arr)
    result=module.coverage_audit(p,None,None,64)
    assert result["cells_inside_boundary"]==20
    assert result["valid_elevation_cells"]==19
    assert result["nodata_or_nonfinite_cells_inside_boundary"]==1


def test_seam_audit_reports_exact_and_different_cells(tmp_path):
    a=tmp_path/"a.tif"; b=tmp_path/"b.tif"
    write_dem(a,np.ones((3,3)),x=0)
    other=np.ones((3,3)); other[:,0]=2
    write_dem(b,other,x=2)
    result=module.seam_audit([a,b])[0]
    assert result["status"]=="compared"
    assert result["comparable_valid_cells"]==3
    assert result["different_cells"]==3
    assert result["max_abs_difference"]==1

def test_seam_audit_compares_adjacent_edge_cells(tmp_path):
    a=tmp_path/"left.tif"; b=tmp_path/"right.tif"
    write_dem(a,np.ones((3,3)),x=0)
    right=np.ones((3,3)); right[:,0]=4
    write_dem(b,right,x=3)
    result=module.seam_audit([a,b])[0]
    assert result["status"]=="adjacent_edge_compared"
    assert result["comparable_valid_pairs"]==3
    assert result["different_pairs"]==3
    assert result["max_abs_edge_step_m"]==3
