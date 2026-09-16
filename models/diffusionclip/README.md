# lysterfield notes

Private Cog deployment of [gwang-kim/DiffusionCLIP](https://github.com/gwang-kim/DiffusionCLIP)
(the public `gwang-kim/diffusionclip:a64682e...` Replicate listing this
project used before), self-hosted at
[replicate.com/superhighfives/diffusionclip](https://replicate.com/superhighfives/diffusionclip)
after the public listing turned out to have an unreliable, sometimes
multi-hour cold boot — see
[`plans/done/phase-3-port-frame-steps.md`](../../plans/done/phase-3-port-frame-steps.md)
for that history, and
[`plans/in-progress/phase-5-end-to-end-parity-check.md`](../../plans/in-progress/phase-5-end-to-end-parity-check.md)
for why this replaces `flux-kontext-dev` as the artwork step's model.

## Scope

Only the ImageNet "Watercolor art" style transfer path is kept —
`run.py` hardcodes it (no `manipulation`/`edit_type` choice), and only
the one matching fine-tuned checkpoint is fetched. The upstream repo's
Human face / Dog face manipulation modes, and its CelebA_HQ/LSUN/AFHQ
dataset loaders, were dropped entirely (see `datasets/data_utils.py`) —
narrower than upstream, not a general-purpose port.

## Weights

Not committed (large binaries, gitignored) — fetched at `cog build` time
by `cog.yaml`'s `run:` steps, each in its own Docker layer so editing
`run.py` later doesn't force re-uploading multi-GB files on `cog push`:

- `pretrained/512x512_diffusion.pt` — the base (unconditional) ImageNet
  diffusion model, from OpenAI's
  [guided-diffusion](https://github.com/openai/guided-diffusion) project,
  fetched directly via `curl`.
- `checkpoint/imagenet_watercolor_t601.pth` — the fine-tuned watercolor
  checkpoint, fetched via `gdown` (Google Drive, linked from upstream's
  README's "ImageNet Style Transfer" section).

DiffusionCLIP blends both at inference time (`diffusionclip.py`'s
`edit_one_image()` loads `model_paths = [None, args.model_path]` — the
`None` entry resolves to the base model via `configs/paths_config.py`).
**Both fetches must use absolute `/src/...` paths** — `cog.yaml`'s `run:`
steps execute before cog's own `WORKDIR /src`, so a relative path here
silently lands at the container root instead of where the app's own
relative `pretrained/...`/`checkpoint/...` paths resolve at request time.
Confirmed as a real bug by inspecting the built image directly
(`docker run --rm --entrypoint bash <image> -c "ls /src/pretrained"`),
not assumed — the failure mode (`FileNotFoundError` only inside a real
prediction, well after `setup()` succeeds) doesn't otherwise point at "the
file is in the wrong directory."

## Local test

No local GPU on this machine — `run.py` hardcodes `cuda:0` so a real
`cog predict` isn't possible here. What *is* possible, and much faster
than iterating against Replicate's GPU queue: `docker run --rm -p
5050:5000 <image>` and hit `/predictions` directly. A correct build
reaches `RuntimeError: Found no NVIDIA driver` — i.e. it gets all the way
through loading both checkpoints and only fails on the CUDA call itself,
which is the expected/correct local failure mode. Every other error
caught during development (`No module named 'cffi'`, then a `gcc`
compile error, then the wrong-checkpoint-path bug above) showed up this
way, each in a few seconds, instead of a 10+ minute round trip to
Replicate's GPU queue.

## Status

Deployed at `replicate.com/superhighfives/diffusionclip` (Nvidia T4).
Locally verified reaching the expected "no NVIDIA driver" failure point;
a real end-to-end prediction against Replicate's actual GPU hardware is
the last open validation step — see phase 5's plan for the current state.

---

# DiffusionCLIP: Text-Guided Diffusion Models for Robust Image Manipulation (CVPR 2022) 

[![Replicate](https://replicate.com/gwang-kim/diffusionclip/badge)](https://replicate.com/gwang-kim/diffusionclip) [![Open In Spaces](https://camo.githubusercontent.com/00380c35e60d6b04be65d3d94a58332be5cc93779f630bcdfc18ab9a3a7d3388/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f25463025394625413425393725323048756767696e67253230466163652d5370616365732d626c7565)](https://huggingface.co/gwang-kim/DiffusionCLIP-CelebA_HQ)
[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/drive/1n50M3cEGyU6O1DyB791fz43RwnbavPS4?usp=sharing) 

[![arXiv](https://img.shields.io/badge/paper-cvpr2022-cyan)](https://openaccess.thecvf.com/content/CVPR2022/html/Kim_DiffusionCLIP_Text-Guided_Diffusion_Models_for_Robust_Image_Manipulation_CVPR_2022_paper.html) [![arXiv](https://img.shields.io/badge/arXiv-2110.02711-red)](https://arxiv.org/abs/2110.02711)
[![video](https://img.shields.io/badge/video-green)](https://youtu.be/YVCtaXw6fw8) [![poster](https://img.shields.io/badge/poster-orange)](https://drive.google.com/file/d/1QgRFIRba492dCZ6v7BcZB9zqyp91aTjL/view?usp=sharing) 

<p align="center">

  <img src="https://github.com/submission10095/DiffusionCLIP_temp/blob/master/imgs/main1.png" />

  <img src="https://github.com/submission10095/DiffusionCLIP_temp/blob/master/imgs/main2.png" />

</p> 

[comment]: <> (![]&#40;imgs/main1.png&#41;)

[comment]: <> (![]&#40;imgs/main2.png&#41;)

> **DiffusionCLIP: Text-Guided Diffusion Models for Robust Image Manipulation**<br>
> [Gwanghyun Kim](https://gwang-kim.github.io/), Taesung Kwon, [Jong Chul Ye](https://bispl.weebly.com/professor.html) <br>
> CVPR 2022
> 
>**Abstract**: <br>
Recently, GAN inversion methods combined with Contrastive Language-Image Pretraining (CLIP) enables zero-shot image manipulation guided by text prompts. 
> However, their applications to diverse real images are still difficult due to the limited GAN inversion capability. 
> Specifically, these approaches often have difficulties in reconstructing images with novel poses, views, and highly variable contents compared to the training data, altering object identity, or producing unwanted image artifacts. 
> To mitigate these problems and enable faithful manipulation of real images, we propose a novel method, dubbed DiffusionCLIP, that performs text-driven image manipulation using diffusion models. 
> Based on full inversion capability and high-quality image generation power of recent diffusion models, our method performs zero-shot image manipulation successfully even between unseen domains 
> and takes another step towards general application by manipulating images from a widely varying ImageNet dataset.
> Furthermore, we propose a novel noise combination method that allows straightforward multi-attribute manipulation. 
> Extensive experiments and human evaluation confirmed robust and superior manipulation performance of our methods compared to the existing baselines.

## Description

This repo includes the official PyTorch implementation of DiffusionCLIP, Text-Guided Diffusion Models for Robust Image Manipulation.
DiffusionCLIP resolves the critical issues in zero-shot manipulation with the following contributions.
- We revealed that diffusion model is well suited for image manipulation thanks to its nearly **perfect inversion** capability, which is an important advantage over GAN-based models and hadn't been analyzed in depth before our detailed comparison.
- Our novel sampling strategies for fine-tuning can preserve perfect reconstruction at **increased speed**.
- In terms of empirical results, our method enables accurate **in- and out-of-domain manipulation**, minimizes unintended changes, and significantly outperformes SOTA baselines. 
- **Our method takes another step towards <span style="color:red">general application</span> by manipulating images from a <span style="color:red">widely varying ImageNet</span> dataset**.
- Finally, our **zero-shot translation between unseen domains** and **multi-attribute transfer** can effectively reduce manual intervention.

The training process is illustrated in the following figure. **Once the diffusion model is fine-tuned, any image from the pretrained domain can be manipulated into the corresponding to the target text without re-training**:
 
![](imgs/method1.png)

We also propose two fine-tuning scheme. Quick original fine-tuning and GPU-efficient fine-tuning. For more details, please refer to Sec. B.1 in Supplementary Material.
![](imgs/method2.png)


## Getting Started

### Installation
We recommend running our code using:

- NVIDIA GPU + CUDA, CuDNN
- Python 3, Anaconda

To install our implementation, clone our repository and run following commands to install necessary packages:
  ```shell script
conda install --yes -c pytorch pytorch=1.7.1 torchvision cudatoolkit=<CUDA_VERSION>
pip install -r requirements.txt
pip install git+https://github.com/openai/CLIP.git
```
### Resources
- For the original fine-tuning, VRAM of 24 GB+ for 256x256 images are required.  
- For the GPU-efficient fine-tuning, VRAM of 12 GB+ for 256x256 images and 24 GB+ for 512x512 images are required.   
- For the inference, VRAM of 6 GB+ for 256x256 images and 9 GB+ for 512x512 images are required.  

### Pretrained Models for DiffusionCLIP Fine-tuning

To manipulate soure images into images in CLIP-guided domain, the **pretrained Diffuson models** are required.

| Image Type to Edit |Size| Pretrained Model | Dataset | Reference Repo. 
|---|---|---|---|---
| Human face |256×256| Diffusion (Auto), [IR-SE50](https://drive.google.com/file/d/1KW7bjndL3QG3sxBbZxreGHigcCCpsDgn/view) | [CelebA-HQ](https://arxiv.org/abs/1710.10196) | [SDEdit](https://github.com/ermongroup/SDEdit), [TreB1eN](https://github.com/TreB1eN/InsightFace_Pytorch) 
| Church |256×256| Diffusion (Auto) | [LSUN-Bedroom](https://www.yf.io/p/lsun) | [SDEdit](https://github.com/ermongroup/SDEdit) 
| Bedroom |256×256| Diffusion (Auto) | [LSUN-Church](https://www.yf.io/p/lsun) | [SDEdit](https://github.com/ermongroup/SDEdit) 
| Dog face |256×256| [Diffusion](https://drive.google.com/file/d/14OG_o3aa8Hxmfu36IIRyOgRwEP6ngLdo/view) | [AFHQ-Dog](https://arxiv.org/abs/1912.01865) | [ILVR](https://github.com/jychoi118/ilvr_adm)
| ImageNet |512×512| [Diffusion](https://openaipublic.blob.core.windows.net/diffusion/jul-2021/512x512_diffusion.pt) | [ImageNet](https://image-net.org/index.php) | [Guided Diffusion](https://github.com/openai/guided-diffusion)
- The pretrained Diffuson models on 256x256 images in [CelebA-HQ](https://arxiv.org/abs/1710.10196), [LSUN-Church](https://www.yf.io/p/lsun), and [LSUN-Bedroom](https://www.yf.io/p/lsun) are automatically downloaded in the code.
- In contrast, you need to download the models pretrained on [AFHQ-Dog-256](https://arxiv.org/abs/1912.01865) or [ImageNet-512](https://image-net.org/index.php) in the table and put it in `./pretrained` directory. 
- In addition, to use ID loss for preserving Human face identity, you are required to download the pretrained [IR-SE50](https://drive.google.com/file/d/1KW7bjndL3QG3sxBbZxreGHigcCCpsDgn/view) model from [TreB1eN](https://github.com/TreB1eN/InsightFace_Pytorch)  and put it in `./pretrained` directory.


### Datasets 
To precompute latents and fine-tune the Diffusion models, you need about 30+ images in the source domain. You can use both **sampled images** from the pretrained models or **real source images** from the pretraining dataset. 
If you want to use **real source images**,  
- for [CelebA-HQ](https://drive.google.com/drive/folders/0B4qLcYyJmiz0TXY1NG02bzZVRGs?resourcekey=0-arAVTUfW9KRhN-irJchVKQ), and [AFHQ-Dog](https://github.com/clovaai/stargan-v2), you can use following code:    
```
# CelebA-HQ 256x256
bash data_download.sh celeba_hq .

# AFHQ-Dog 256x256
bash data_download.sh afhq .
```
- for [LSUN-Church](https://www.yf.io/p/lsun), [LSUN-Bedroom](https://www.yf.io/p/lsun) or [ImageNet](https://image-net.org/index.php), you can download them from the linked original sources and put them in `./data/lsun` or `./data/imagenet`.

If you want to use custom paths, you can simply modify `./configs/paths_config.py`.


### Colab Notebook [![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/drive/1n50M3cEGyU6O1DyB791fz43RwnbavPS4?usp=sharing)
We provide a colab notebook for you to play with DiffusionCLIP! Due to 12GB of the VRAM limit in Colab, we only provide the codes of inference & applications with the fine-tuned DiffusionCLIP models, not fine-tuning code. 
We provide a wide range of types of edits, and you can also upload your fine-tuned models following below instructions on Colab and test them.



## Fine-tuning and other applications (not in this deployment)

Upstream documents CLIP fine-tuning plus several manipulation/translation
applications (human/dog face, church, bedroom) — see the **Scope** section
at the top of this file for why none of that is wired up here. Those
commands referenced `--config celeba.yml`/`bedroom.yml`/`church.yml`/
`afhq.yml`, which this deployment doesn't carry (removed along with the
matching unused dataset loaders — see `datasets/data_utils.py`), so the
original examples are cut rather than left pointing at configs that no
longer exist in this tree. See the upstream repo linked above for the
full fine-tuning and application walkthroughs.

## Finetuned Models Using DiffuionCLIP

We provide a Google Drive containing several fintuned models using DiffusionCLIP. [Human Face, Dog Face, Church, Bedroom](https://drive.google.com/drive/folders/1Uwvm_gckanyRzQkVTLB6GLQbkSBoZDZF?usp=sharing),
[ImageNet Style Transfer](https://drive.google.com/drive/folders/1Qb9jcv3Be3k7UtVQykI2PWqznUzb0t8R?usp=sharing), [ImageNet Tennis Ball](https://drive.google.com/drive/folders/1I3rhsPbEkQkWeoGW9kryv8nB_eLeHXfY?usp=sharing)

## Related Works

Usage of guidance by [CLIP](https://arxiv.org/abs/2103.00020) to manipulate images is motivated by [StyleCLIP](https://arxiv.org/abs/2103.17249) and [StyleGAN-NADA](https://arxiv.org/abs/2108.00946).
Image translation from an unseen domain to the trained domain using diffusion models is introduced in [SDEdit](https://arxiv.org/abs/2108.01073), [ILVR](https://arxiv.org/abs/2108.02938).
DDIM sampling and its reveral for generation and inversion of images are introduced by in [DDIM](https://arxiv.org/abs/2010.02502), [Diffusion Models Beat GANs on Image Synthesis](https://arxiv.org/abs/2105.05233).

Our code strcuture is based on the official codes of [SDEdit](https://github.com/ermongroup/SDEdit) and [StyleGAN-NADA](https://github.com/rinongal/StyleGAN-nada). We used pretrained models from [SDEdit](https://github.com/ermongroup/SDEdit) and [ILVR](https://github.com/jychoi118/ilvr_adm).


## Citation
If you find DiffusionCLIP useful in your research, please consider citing:

    @InProceedings{Kim_2022_CVPR,
        author    = {Kim, Gwanghyun and Kwon, Taesung and Ye, Jong Chul},
        title     = {DiffusionCLIP: Text-Guided Diffusion Models for Robust Image Manipulation},
        booktitle = {Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)},
        month     = {June},
        year      = {2022},
        pages     = {2426-2435}
    }

## Additional Results

Here, we show more manipulation of real images in the diverse datasets using DiffusionCLIP where the original pretrained models
are trained on [AFHQ-Dog](https://arxiv.org/abs/1912.01865), [LSUN-Bedroom](https://www.yf.io/p/lsun) and [ImageNet](https://image-net.org/index.php), respectively.

[comment]: <> (![]&#40;imgs/more_manipulation1.png&#41;)

[comment]: <> (![]&#40;imgs/more_manipulation2.png&#41;)

[comment]: <> (![]&#40;imgs/more_manipulation3.png&#41;)

[comment]: <> (![]&#40;imgs/more_manipulation4.png&#41;)

<p align="center">

  <img src="https://github.com/submission10095/DiffusionCLIP_temp/blob/master/imgs/more_manipulation1.png" />

  <img src="https://github.com/submission10095/DiffusionCLIP_temp/blob/master/imgs/more_manipulation2.png" />

  <img src="https://github.com/submission10095/DiffusionCLIP_temp/blob/master/imgs/more_manipulation3.png" />

  <img src="https://github.com/submission10095/DiffusionCLIP_temp/blob/master/imgs/more_manipulation4.png" />

</p>
