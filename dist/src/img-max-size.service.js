import { Injectable, Inject, forwardRef } from '@angular/core';
import { Subject } from 'rxjs';
import { ImgExifService } from './img-exif.service';
var MAX_STEPS = 15;
var ImgMaxSizeService = /** @class */ (function () {
    function ImgMaxSizeService(imageExifService) {
        this.imageExifService = imageExifService;
    }
    ImgMaxSizeService.prototype.compressImage = function (file, maxSizeInMB, ignoreAlpha, logExecutionTime) {
        var _this = this;
        if (ignoreAlpha === void 0) { ignoreAlpha = false; }
        if (logExecutionTime === void 0) { logExecutionTime = false; }
        var compressedFileSubject = new Subject();
        this.timeAtStart = new Date().getTime();
        this.initialFile = file;
        if (file.type !== "image/jpeg" && file.type !== "image/png") {
            //END OF COMPRESSION
            setTimeout(function () {
                compressedFileSubject.error({ compressedFile: file, reason: "File provided is neither of type jpg nor of type png.", error: "INVALID_EXTENSION" });
            }, 0);
            return compressedFileSubject.asObservable();
        }
        var oldFileSize = file.size / 1024 / 1024;
        if (oldFileSize < maxSizeInMB) {
            // END OF COMPRESSION
            // FILE SIZE ALREADY BELOW MAX_SIZE -> no compression needed
            setTimeout(function () { compressedFileSubject.next(file); }, 0);
            return compressedFileSubject.asObservable();
        }
        var cvs = document.createElement('canvas');
        var ctx = cvs.getContext('2d');
        var img = new Image();
        var self = this;
        img.onload = function () {
            _this.imageExifService.getOrientedImage(img).then(function (orientedImg) {
                window.URL.revokeObjectURL(img.src);
                cvs.width = orientedImg.width;
                cvs.height = orientedImg.height;
                ctx.drawImage(orientedImg, 0, 0);
                var imageData = ctx.getImageData(0, 0, orientedImg.width, orientedImg.height);
                if (file.type === "image/png" && _this.isImgUsingAlpha(imageData) && !ignoreAlpha) {
                    //png image with alpha
                    compressedFileSubject.error({ compressedFile: file, reason: "File provided is a png image which uses the alpha channel. No compression possible.", error: "PNG_WITH_ALPHA" });
                }
                ctx = cvs.getContext('2d', { 'alpha': false });
                ctx.drawImage(orientedImg, 0, 0);
                self.getCompressedFile(cvs, 50, maxSizeInMB, 1).then(function (compressedFile) {
                    compressedFileSubject.next(compressedFile);
                    self.logExecutionTime(logExecutionTime);
                }).catch(function (error) {
                    compressedFileSubject.error(error);
                    self.logExecutionTime(logExecutionTime);
                });
            });
        };
        img.src = window.URL.createObjectURL(file);
        return compressedFileSubject.asObservable();
    };
    ;
    ImgMaxSizeService.prototype.getCompressedFile = function (cvs, quality, maxSizeInMB, currentStep) {
        var _this = this;
        var result = new Promise(function (resolve, reject) {
            cvs.toBlob(function (blob) {
                if (currentStep + 1 > MAX_STEPS) {
                    //COMPRESSION END
                    //maximal steps reached
                    reject({ compressedFile: _this.getResultFile(blob), reason: "Could not find the correct compression quality in " + MAX_STEPS + " steps.", error: "MAX_STEPS_EXCEEDED" });
                }
                else {
                    var newQuality = _this.getCalculatedQuality(blob, quality, maxSizeInMB, currentStep);
                    _this.checkCompressionStatus(cvs, blob, quality, maxSizeInMB, currentStep, newQuality)
                        .then(function (result) {
                        resolve(result);
                    })
                        .catch(function (result) {
                        reject(result);
                    });
                }
            }, "image/jpeg", quality / 100);
        });
        return result;
    };
    ImgMaxSizeService.prototype.getResultFile = function (blob) {
        return this.generateResultFile(blob, this.initialFile.name, this.initialFile.type, new Date().getTime());
    };
    ImgMaxSizeService.prototype.generateResultFile = function (blob, name, type, lastModified) {
        var resultFile = new Blob([blob], { type: type });
        return this.blobToFile(resultFile, name, lastModified);
    };
    ImgMaxSizeService.prototype.blobToFile = function (blob, name, lastModified) {
        var file = blob;
        file.name = name;
        file.lastModified = lastModified;
        //Cast to a File() type
        return file;
    };
    ImgMaxSizeService.prototype.getCalculatedQuality = function (blob, quality, maxSizeInMB, currentStep) {
        //CALCULATE NEW QUALITY
        var currentSize = blob.size / 1024 / 1024;
        var ratioMaxSizeToCurrentSize = maxSizeInMB / currentSize;
        if (ratioMaxSizeToCurrentSize > 5) {
            //max ratio to avoid extreme quality values
            ratioMaxSizeToCurrentSize = 5;
        }
        var ratioMaxSizeToInitialSize = currentSize / (this.initialFile.size / 1024 / 1024);
        if (ratioMaxSizeToInitialSize < 0.05) {
            //min ratio to avoid extreme quality values
            ratioMaxSizeToInitialSize = 0.05;
        }
        var newQuality = 0;
        var multiplicator = Math.abs(ratioMaxSizeToInitialSize - 1) * 10 / (currentStep * 1.7) / ratioMaxSizeToCurrentSize;
        if (multiplicator < 1) {
            multiplicator = 1;
        }
        if (ratioMaxSizeToCurrentSize >= 1) {
            newQuality = quality + (ratioMaxSizeToCurrentSize - 1) * 10 * multiplicator;
        }
        else {
            newQuality = quality - (1 - ratioMaxSizeToCurrentSize) * 10 * multiplicator;
        }
        if (newQuality > 100) {
            //max quality = 100, so let's set the new quality to the value in between the old quality and 100 in case of > 100
            newQuality = quality + (100 - quality) / 2;
        }
        if (newQuality < 0) {
            //min quality = 0, so let's set the new quality to the value in between the old quality and 0 in case of < 0
            newQuality = quality - quality / 2;
        }
        return newQuality;
    };
    ImgMaxSizeService.prototype.checkCompressionStatus = function (cvs, blob, quality, maxSizeInMB, currentStep, newQuality) {
        var _this = this;
        var result = new Promise(function (resolve, reject) {
            if (quality === 100 && newQuality >= 100) {
                //COMPRESSION END
                //Seems like quality 100 is max but file still too small, case that shouldn't exist as the compression shouldn't even have started in the first place
                reject({ compressedFile: _this.initialFile, reason: "Unfortunately there was an error while compressing the file.", error: "FILE_BIGGER_THAN_INITIAL_FILE" });
            }
            else if ((quality < 1) && (newQuality < quality)) {
                //COMPRESSION END
                //File size still too big but can't compress further than quality=0
                reject({ compressedFile: _this.getResultFile(blob), reason: "Could not compress image enough to fit the maximal file size limit.", error: "UNABLE_TO_COMPRESS_ENOUGH" });
            }
            else if ((newQuality > quality) && (Math.round(quality) == Math.round(newQuality))) {
                //COMPRESSION END
                //next steps quality would be the same quality but newQuality is slightly bigger than old one, means we most likely found the nearest quality to compress to maximal size
                resolve(_this.getResultFile(blob));
            }
            else if (currentStep > 5 && (newQuality > quality) && (newQuality < quality + 2)) {
                //COMPRESSION END
                //for some rare occasions the algorithm might be stuck around e.g. 98.5 and 97.4 because of the maxQuality of 100, the current quality is the nearest possible quality in that case
                resolve(_this.getResultFile(blob));
            }
            else if ((newQuality > quality) && Number.isInteger(quality) && (Math.floor(newQuality) == quality)) {
                //COMPRESSION END
                /*
                    in the previous step if ((quality > newQuality) && (Math.round(quality) == Math.round(newQuality))) applied, so
                    newQuality = Math.round(newQuality) - 1; this was done to reduce the quality at least a full integer down to not waste a step
                    with the same compression rate quality as before. Now, the newQuality is still only in between the old quality (e.g. 93)
                    and the newQuality (e.g. 94) which most likely means that the value for the newQuality (the bigger one) would make the filesize
                    too big so we should just stick with the current, lower quality and return that file.
                */
                resolve(_this.getResultFile(blob));
            }
            else {
                //CONTINUE COMPRESSION
                if ((quality > newQuality) && (Math.round(quality) == Math.round(newQuality))) {
                    //quality can only be an integer -> make sure difference between old quality and new one is at least a whole integer number
                    // - it would be nonsense to compress again with the same quality
                    newQuality = Math.round(newQuality) - 1;
                }
                //recursively call function again
                resolve(_this.getCompressedFile(cvs, newQuality, maxSizeInMB, currentStep + 1));
            }
        });
        return result;
    };
    ImgMaxSizeService.prototype.isImgUsingAlpha = function (imageData) {
        for (var i = 0; i < imageData.data.length; i += 4) {
            if (imageData.data[i + 3] !== 255) {
                return true;
            }
        }
        return false;
    };
    ImgMaxSizeService.prototype.logExecutionTime = function (logExecutionTime) {
        if (logExecutionTime) {
            console.info("Execution time: ", new Date().getTime() - this.timeAtStart + "ms");
        }
    };
    ImgMaxSizeService.decorators = [
        { type: Injectable },
    ];
    /** @nocollapse */
    ImgMaxSizeService.ctorParameters = function () { return [
        { type: ImgExifService, decorators: [{ type: Inject, args: [forwardRef(function () { return ImgExifService; }),] }] }
    ]; };
    return ImgMaxSizeService;
}());
export { ImgMaxSizeService };
//# sourceMappingURL=img-max-size.service.js.map