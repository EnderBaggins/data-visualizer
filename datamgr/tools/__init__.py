"""Building blocks that methods share (field-line sampling, energetics, ...): the project's tools/ folder
(project.json "tools"). Import them inside a method:

    from datamgr.tools.fieldlines import along_points        # = <project>/tools/fieldlines.py
"""
import os

from .. import config

__path__[:0] = [d for d in config.TOOLS_DIRS if os.path.isdir(d)]
