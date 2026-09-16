import os
import shutil
import tempfile
import warnings

import yaml
from PIL import Image

warnings.filterwarnings(action="ignore")
from cog import BaseRunner, Path, Input

from diffusionclip import DiffusionCLIP
from main import dict2namespace

MODEL_PATH = "checkpoint/imagenet_watercolor_t601.pth"
T_0 = 601


class Runner(BaseRunner):
    def setup(self):
        with open(os.path.join("configs", "imagenet.yml"), "r") as f:
            config_dic = yaml.safe_load(f)
        self.config = dict2namespace(config_dic)
        self.config.device = "cuda:0"

    def run(
        self,
        image: Path = Input(description="Input image."),
        degree_of_change: float = Input(default=1.0, ge=0.0, le=1.0),
        n_test_step: int = Input(default=12, ge=5, le=100),
    ) -> Path:
        exp_dir = tempfile.mkdtemp()
        try:
            args_dic = {
                "t_0": T_0,
                "n_inv_step": 40,
                "n_test_step": n_test_step,
                "sample_type": "ddim",
                "eta": 0.0,
                "bs_test": 1,
                "model_path": MODEL_PATH,
                "img_path": str(image),
                "deterministic_inv": 1,
                "hybrid_noise": 0,
                "n_iter": 1,
                "align_face": 0,
                "image_folder": exp_dir,
                "model_ratio": degree_of_change,
                "edit_attr": None,
                "src_txts": None,
                "trg_txts": None,
            }
            args = dict2namespace(args_dic)

            diffusionclip_model = DiffusionCLIP(args, self.config)
            diffusionclip_model.edit_one_image()

            out_image = Image.open(
                f"{exp_dir}/3_gen_t{T_0}_it0_ninv40_ngen{n_test_step}_mrat{degree_of_change}_imagenet_watercolor_t601.png"
            )
            out_path = Path(tempfile.mkdtemp()) / "output.png"
            out_image.save(str(out_path))
        finally:
            shutil.rmtree(exp_dir, ignore_errors=True)

        return out_path
