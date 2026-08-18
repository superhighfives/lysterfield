import io

import matplotlib
import numpy as np
import torch
import torchvision.transforms as T
from cog import BasePredictor, Input, Path
from PIL import Image

matplotlib.use("Agg")
import matplotlib.pyplot as plt

MEAN = torch.as_tensor([0.4850, 0.4560, 0.4060])
STD = torch.as_tensor([0.2290, 0.2240, 0.2250])


class Predictor(BasePredictor):
    def setup(self):
        self.model = torch.load("torch_650.pkl", map_location="cpu")
        self.model.eval()

    def predict(
        self,
        image: Path = Input(description="Input image to convert to line art"),
        input_size: int = Input(
            description="Resolution the model runs at (300 matches the original pipeline's usage)",
            default=300,
        ),
        output_size: int = Input(description="Output image resolution", default=1024),
    ) -> Path:
        img = Image.open(image).convert("RGB").resize((input_size, input_size))

        with torch.no_grad():
            img_t = T.ToTensor()(img)
            img_t = (img_t - MEAN[..., None, None]) / STD[..., None, None]
            img_t = img_t[None]
            _, img_hr, _ = self.model(img_t)[0]
            img_hr = img_hr * STD[..., None, None] + MEAN[..., None, None]
            img_hr_np = img_hr.to("cpu").numpy().transpose((1, 2, 0))

        fig, ax = plt.subplots(figsize=(10.24, 10.24))
        ax.axis("off")
        ax.imshow(img_hr_np, "binary")
        buf = io.BytesIO()
        fig.savefig(buf, bbox_inches="tight", pad_inches=0)
        plt.close(fig)

        out = Image.open(buf).resize(
            (output_size, output_size), resample=Image.Resampling.BILINEAR
        ).convert("L")
        out_path = "/tmp/out.png"
        out.save(out_path)
        return Path(out_path)
