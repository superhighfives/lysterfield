from torch.utils.data import DataLoader
from .IMAGENET_dataset import get_imagenet_dataset

# AFHQ/CelebA_HQ/LSUN dataset loaders dropped — this fork only ever calls
# edit_one_image() against IMAGENET (watercolor style transfer), which
# doesn't reach get_dataset() at all; this import chain only exists
# because diffusionclip.py imports it unconditionally at module load.
# CelebA_HQ_dataset/LSUN_dataset also pulled in `lmdb`, whose cffi
# bindings need a full bundled-source build (system liblmdb-dev alone
# isn't enough — it's missing lmdb's own preload.h) purely for a dataset
# type this deployment never uses.
def get_dataset(dataset_type, dataset_paths, config, target_class_num=None, gender=None):
    if dataset_type == "IMAGENET":
        train_dataset, test_dataset = get_imagenet_dataset(dataset_paths['IMAGENET'], config, class_num=target_class_num)
    else:
        raise ValueError

    return train_dataset, test_dataset


def get_dataloader(train_dataset, test_dataset, bs_train=1, num_workers=0):
    train_loader = DataLoader(
        train_dataset,
        batch_size=bs_train,
        drop_last=True,
        shuffle=True,
        sampler=None,
        num_workers=num_workers,
        pin_memory=True,
    )
    test_loader = DataLoader(
        test_dataset,
        batch_size=1,
        drop_last=True,
        sampler=None,
        shuffle=True,
        num_workers=num_workers,
        pin_memory=True,
    )

    return {'train': train_loader, 'test': test_loader}


